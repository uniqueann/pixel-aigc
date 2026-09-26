import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { bailianConfig, cropOutpaintResult, expandWithBailian } from './bailian-outpaint'
import { HttpError } from './errors'
import { planBailianOutpaint } from '../shared/outpaint'

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

describe('百炼扩图调用', () => {
  it('只传四边偏移，取回结果后裁成精确目标尺寸', async () => {
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
      if (url.endsWith('/out-painting')) {
        return new Response(JSON.stringify({ output: { task_id: 'task-1', task_status: 'PENDING' } }), { status: 200 })
      }
      if (url.endsWith('/tasks/task-1')) {
        return new Response(JSON.stringify({
          output: { task_id: 'task-1', task_status: 'SUCCEEDED', output_image_url: 'https://example.test/out.jpg' },
        }), { status: 200 })
      }
      return new Response(model, { status: 200, headers: { 'Content-Type': 'image/jpeg' } })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    const body = JSON.parse(calls[0].body ?? '{}') as { parameters: Record<string, unknown> }
    expect(body.parameters).toMatchObject({
      left_offset: plan.offsets.left,
      right_offset: plan.offsets.right,
      top_offset: plan.offsets.top,
      bottom_offset: plan.offsets.bottom,
      add_watermark: false,
      best_quality: false,
    })
    expect(body.parameters.output_ratio).toBeUndefined()
    expect(body.parameters.x_scale).toBeUndefined()
    expect(body.parameters.y_scale).toBeUndefined()
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(1160)
    expect(meta.height).toBe(880)
    expect(meta.format).toBe('jpeg')
  })

  it('模型把短边补宽后，本地裁掉多出来的边', async () => {
    const plan = planBailianOutpaint(2000, 512, { left: 1500, right: 1500, top: 0, bottom: 0 })
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 1, g: 2, b: 3 } },
    }).jpeg().toBuffer()
    const output = await cropOutpaintResult(model, plan)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(5000)
    expect(meta.height).toBe(512)
  })

  it('任务失败时返回服务端说明', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/out-painting')) {
        return new Response(JSON.stringify({ output: { task_id: 'task-2', task_status: 'PENDING' } }), { status: 200 })
      }
      return new Response(JSON.stringify({
        output: { task_status: 'FAILED', code: 'InvalidParameter.ImageContent', message: 'The image content does not comply' },
      }), { status: 200 })
    }
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ message: '这张图片没有通过内容审核', status: 502 })
  })

  it('没有配置时不发起请求', async () => {
    await expect(expandWithBailian(Buffer.from('jpeg'), { left: 1, right: 0, top: 0, bottom: 0 }, { env: {} }))
      .rejects.toBeInstanceOf(HttpError)
  })
})
