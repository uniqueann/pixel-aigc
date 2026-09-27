import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { bailianConfig, cropOutpaintResult, expandWithBailian } from './bailian-outpaint'
import { HttpError } from './errors'
import { DEFAULT_EXPAND_PROMPT, planBailianOutpaint } from '../shared/outpaint'

describe('百炼扩图配置', () => {
  it('有 API Key 才算已配置，请求地址可以改成业务空间域名', () => {
    expect(bailianConfig({})).toBeNull()
    expect(bailianConfig({ DASHSCOPE_API_KEY: '  sk-test  ' })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.aliyuncs.com',
    })
    expect(bailianConfig({
      DASHSCOPE_API_KEY: 'sk-test',
      DASHSCOPE_BASE_URL: 'https://ws-example.cn-beijing.maas.aliyuncs.com/',
    })).toMatchObject({ baseUrl: 'https://ws-example.cn-beijing.maas.aliyuncs.com' })
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('万相扩图调用', () => {
  it('提交 wanx2.1-imageedit expand，取回结果后裁成精确目标尺寸', async () => {
    const source = await sharp({
      create: { width: 1000, height: 800, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer()
    const padding = { left: 40, right: 120, top: 10, bottom: 70 }
    const plan = planBailianOutpaint(1000, 800, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 200, g: 10, b: 10 } },
    }).jpeg().toBuffer()
    const calls: Array<{ url: string; body?: string }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      calls.push({ url, body: init?.body ? String(init.body) : undefined })
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-1', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-1')) {
        return jsonResponse({
          output: { task_id: 'task-1', task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] },
        })
      }
      return new Response(model, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    const body = JSON.parse(calls[0].body ?? '{}') as {
      model: string
      input: { function: string; prompt: string; base_image_url: string }
      parameters: Record<string, unknown>
    }
    expect(calls[0].url).toContain('/api/v1/services/aigc/image2image/image-synthesis')
    expect(body.model).toBe('wanx2.1-imageedit')
    expect(body.input.function).toBe('expand')
    expect(body.input.prompt).toBe(DEFAULT_EXPAND_PROMPT)
    expect(body.input.prompt.length).toBeLessThanOrEqual(800)
    expect(body.input.base_image_url.startsWith('data:image/jpeg;base64,')).toBe(true)
    expect(body.parameters).toMatchObject({
      left_scale: plan.passes[0].scales.left,
      right_scale: plan.passes[0].scales.right,
      top_scale: plan.passes[0].scales.top,
      bottom_scale: plan.passes[0].scales.bottom,
      n: 1,
      watermark: false,
    })
    expect(body.parameters.left_offset).toBeUndefined()
    expect(body.parameters.x_scale).toBeUndefined()
    expect(body.parameters.y_scale).toBeUndefined()
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(1160)
    expect(meta.height).toBe(880)
    expect(meta.format).toBe('jpeg')
  })

  it('单边超过 2 倍时会再提交一次 expand', async () => {
    const source = await sharp({
      create: { width: 800, height: 800, channels: 3, background: { r: 10, g: 20, b: 30 } },
    }).jpeg().toBuffer()
    const padding = { left: 2000, right: 2000, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(800, 800, padding)
    const first = await sharp({
      create: { width: plan.passes[0].modelWidth, height: plan.passes[0].modelHeight, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer()
    const second = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 4, g: 5, b: 6 } },
    }).jpeg().toBuffer()
    let submits = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        submits += 1
        return jsonResponse({ output: { task_id: `task-${submits}`, task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-1')) {
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/one.jpg' }] } })
      }
      if (url.endsWith('/tasks/task-2')) {
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/two.jpg' }] } })
      }
      if (url.endsWith('/one.jpg')) return new Response(first, { status: 200 })
      return new Response(second, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    expect(submits).toBe(2)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(4800)
    expect(meta.height).toBe(800)
  })

  it('模型尺寸和预期不一致时，仍裁成精确目标尺寸', async () => {
    const plan = planBailianOutpaint(2000, 800, { left: 200, right: 200, top: 0, bottom: 0 })
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer()
    const output = await cropOutpaintResult(model, plan)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(2400)
    expect(meta.height).toBe(800)
  })

  it('任务失败时返回服务端说明', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-2', task_status: 'PENDING' } })
      }
      return jsonResponse({
        output: { task_status: 'FAILED', code: 'InvalidParameter.ImageContent', message: 'The image content does not comply' },
      })
    }
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ message: '这张图片没有通过内容审核', status: 502 })
  })

  it('内容审核拒绝（DataInspectionFailed）时给出明确说明', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    const fetchImpl: typeof fetch = async () => jsonResponse({
      code: 'DataInspectionFailed',
      message: 'Input data may contain inappropriate content.',
    }, 400)
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ message: '这张图片没有通过内容审核', status: 502 })
  })

  it('API Key 无效时给出明确说明', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    const fetchImpl: typeof fetch = async () => jsonResponse({
      code: 'InvalidApiKey',
      message: 'No API-key provided.',
    }, 401)
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-bad' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ message: '阿里云百炼 API Key 无效', status: 502 })
  })

  it('账户欠费时给出明确说明', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    const fetchImpl: typeof fetch = async () => jsonResponse({
      code: 'Arrearage',
      message: 'Account is overdue.',
    }, 403)
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ message: '阿里云百炼账户已欠费，请充值后再试', status: 502 })
  })

  it('没有配置时不发起请求', async () => {
    await expect(expandWithBailian(Buffer.from('jpeg'), { left: 1, right: 0, top: 0, bottom: 0 }, { env: {} }))
      .rejects.toBeInstanceOf(HttpError)
  })
})
