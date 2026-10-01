import sharp from 'sharp'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const storageMocks = vi.hoisted(() => ({ putObject: vi.fn(), signRead: vi.fn() }))
vi.mock('./storage', () => ({ putObject: storageMocks.putObject, signRead: storageMocks.signRead }))
import {
  bailianConfig, CONNECT_TIMEOUT_MS, connectRetryDelay, cropOutpaintResult, dashScopeHost, DEFAULT_DEADLINE_MS,
  expandWithBailian, FINISH_RESERVE_MS, GET_ATTEMPTS, isTransientConnectError, OUTPAINT_WAIT_TIMEOUT_MESSAGE,
  outpaintPollDelay, passWaitDeadline, SUBMIT_ATTEMPTS,
} from './bailian-outpaint'
import { HttpError } from './errors'
import { callDashScope } from './dashscope'
import { DEFAULT_EXPAND_PROMPT, planBailianOutpaint } from '../shared/outpaint'

beforeEach(() => {
  storageMocks.putObject.mockReset()
  storageMocks.signRead.mockReset()
})

describe('百炼扩图配置', () => {
  it('有 API Key 才算已配置，请求地址可以改成业务空间域名', () => {
    expect(bailianConfig({})).toBeNull()
    expect(bailianConfig({ DASHSCOPE_API_KEY: '  sk-test  ' })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.aliyuncs.com',
    })
    expect(bailianConfig({
      DASHSCOPE_API_KEY: 'sk-test',
      DASHSCOPE_BASE_URL: '',
    })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.aliyuncs.com',
    })
    expect(bailianConfig({
      DASHSCOPE_API_KEY: 'sk-test',
      DASHSCOPE_BASE_URL: '   ',
    })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://dashscope.aliyuncs.com',
    })
    expect(bailianConfig({
      DASHSCOPE_API_KEY: 'sk-test',
      DASHSCOPE_BASE_URL: 'https://llm-xxxx.cn-beijing.maas.aliyuncs.com/',
    })).toEqual({
      apiKey: 'sk-test',
      baseUrl: 'https://llm-xxxx.cn-beijing.maas.aliyuncs.com',
    })
    expect(dashScopeHost('https://llm-xxxx.cn-beijing.maas.aliyuncs.com')).toBe('llm-xxxx.cn-beijing.maas.aliyuncs.com')
  })
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

describe('万相扩图调用', () => {
  it('总截止时间到达后停止连接重试并返回超时', async () => {
    let clock = 0
    let attempts = 0
    const fetchImpl: typeof fetch = async () => {
      attempts += 1
      clock = 100
      throw Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT' })
    }
    await expect(callDashScope(fetchImpl, 'https://example.test', undefined, 'submit', 3, 35_000,
      async () => {}, () => {}, { now: () => clock }, '连接失败', 'OUTPAINT_FAILED',
      { at: 100, message: '扩图超时', code: 'OUTPAINT_TIMEOUT' },
    )).rejects.toMatchObject({ status: 504, code: 'OUTPAINT_TIMEOUT' })
    expect(attempts).toBe(1)
  })

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

  it('业务空间专属域名只用于提交和查询，结果图仍走绝对地址', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 11, g: 11, b: 11 } },
    }).jpeg().toBuffer()
    const padding = { left: 10, right: 0, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(640, 640, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 12, g: 12, b: 12 } },
    }).jpeg().toBuffer()
    const workspace = 'https://llm-xxxx.cn-beijing.maas.aliyuncs.com'
    const calls: string[] = []
    const logs: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      calls.push(url)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-ws', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-ws')) {
        return jsonResponse({
          output: { task_status: 'SUCCEEDED', results: [{ url: 'https://oss.example.test/out.jpg' }] },
        })
      }
      return new Response(model, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test', DASHSCOPE_BASE_URL: `${workspace}/` },
      sleep: async () => {},
      now: () => 0,
      log: entry => { logs.push(entry) },
    })
    expect(calls[0]).toBe(`${workspace}/api/v1/services/aigc/image2image/image-synthesis`)
    expect(calls[1]).toBe(`${workspace}/api/v1/tasks/task-ws`)
    expect(calls[2]).toBe('https://oss.example.test/out.jpg')
    expect(logs.find(entry => entry.stage === 'plan')).toMatchObject({ host: 'llm-xxxx.cn-beijing.maas.aliyuncs.com' })
    expect(logs.find(entry => entry.stage === 'submit' && entry.status === 200)).toMatchObject({
      host: 'llm-xxxx.cn-beijing.maas.aliyuncs.com',
    })
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(650)
  })

  it('单边超过 2 倍时会再提交一次 expand', async () => {
    storageMocks.signRead.mockImplementation(async (key: string) => ({ url: `https://r2.test/${key}?signed=1` }))
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
    const submittedInputs: string[] = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        submits += 1
        submittedInputs.push((JSON.parse(String(init?.body)) as { input: { base_image_url: string } }).input.base_image_url)
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
      env: { DASHSCOPE_API_KEY: 'sk-test', DASHSCOPE_OUTPAINT_INPUT_MODE: 'url' },
      requestId: 'outpaint-request',
      sleep: async () => {},
      now: () => 0,
    })
    expect(submits).toBe(2)
    expect(submittedInputs).toEqual([
      'https://r2.test/temporary/dashscope-inputs/outpaint/outpaint-request/1/source.jpg?signed=1',
      'https://r2.test/temporary/dashscope-inputs/outpaint/outpaint-request/2/source.jpg?signed=1',
    ])
    expect(storageMocks.putObject).toHaveBeenCalledTimes(2)
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

  it('轮询间隔先密后疏，随后回到 1–2s，等待预算按剩余时间均分', () => {
    expect(outpaintPollDelay(0)).toBe(400)
    expect(outpaintPollDelay(1)).toBe(800)
    expect(outpaintPollDelay(7)).toBe(800)
    expect(outpaintPollDelay(8)).toBe(1_200)
    expect(outpaintPollDelay(19)).toBe(1_200)
    expect(outpaintPollDelay(20)).toBe(2_000)
    expect(DEFAULT_DEADLINE_MS).toBe(90_000)
    expect(FINISH_RESERVE_MS).toBe(20_000)
    expect(passWaitDeadline(0, 90_000, 1)).toBe(70_000)
    expect(passWaitDeadline(10_000, 90_000, 2)).toBe(40_000)
    expect(passWaitDeadline(80_000, 90_000, 1)).toBe(80_000)
  })

  it('只把连接层失败当成可重试，HTTP 响应和 Abort 不重试', () => {
    const timedOut = new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT', name: 'ConnectTimeoutError' }) })
    expect(CONNECT_TIMEOUT_MS).toBe(4_000)
    expect(SUBMIT_ATTEMPTS).toBe(3)
    expect(GET_ATTEMPTS).toBe(3)
    expect(isTransientConnectError(timedOut)).toBe(true)
    expect(isTransientConnectError(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }))).toBe(true)
    expect(isTransientConnectError(Object.assign(new Error('socket hang up'), { code: 'UND_ERR_SOCKET' }))).toBe(true)
    expect(isTransientConnectError(new TypeError('fetch failed'))).toBe(true)
    expect(isTransientConnectError(new DOMException('The operation was aborted', 'AbortError'))).toBe(false)
    expect(isTransientConnectError(Object.assign(new Error('Headers Timeout Error'), { code: 'UND_ERR_HEADERS_TIMEOUT' }))).toBe(false)
    expect(connectRetryDelay(0)).toBe(250)
    expect(connectRetryDelay(1)).toBe(500)
  })

  it('提交 DashScope 时连接失败会重试，用尽后记在 submit 阶段并返回可读错误', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 3, g: 3, b: 3 } },
    }).jpeg().toBuffer()
    const logs: Array<Record<string, unknown>> = []
    const failure = new TypeError('fetch failed', { cause: new Error('Connect Timeout Error') })
    let calls = 0
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: async () => { calls += 1; throw failure },
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
      requestId: 'req-submit-fail',
      log: entry => { logs.push(entry) },
    })).rejects.toMatchObject({
      message: '无法连接到阿里云百炼扩图服务，请稍后重试',
      status: 502,
      code: 'OUTPAINT_FAILED',
      stage: 'submit',
    })
    expect(calls).toBe(SUBMIT_ATTEMPTS)
    expect(logs[0]).toMatchObject({ stage: 'plan' })
    const submits = logs.filter(entry => entry.stage === 'submit')
    expect(submits).toHaveLength(3)
    expect(submits[0]).toMatchObject({ attempt: 1, retry: true, error: 'fetch failed', cause: 'Error: Connect Timeout Error' })
    expect(submits[2]).toMatchObject({ attempt: 3, retry: false, requestId: 'req-submit-fail' })
  })

  it('提交时前两次连接超时、第三次成功则继续扩图', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 4, g: 4, b: 4 } },
    }).jpeg().toBuffer()
    const padding = { left: 10, right: 0, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(640, 640, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 5, g: 5, b: 5 } },
    }).jpeg().toBuffer()
    let submits = 0
    const logs: Array<Record<string, unknown>> = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        submits += 1
        if (submits < 3) {
          throw new TypeError('fetch failed', { cause: Object.assign(new Error('Connect Timeout Error'), { name: 'ConnectTimeoutError' }) })
        }
        return jsonResponse({ output: { task_id: 'task-retry', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-retry')) {
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] } })
      }
      return new Response(model, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
      log: entry => { logs.push(entry) },
    })
    expect(submits).toBe(3)
    expect(logs.filter(entry => entry.stage === 'submit' && entry.retry === true)).toHaveLength(2)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(650)
    expect(meta.height).toBe(640)
  })

  it('提交已收到 HTTP 错误响应时不重试', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    let submits = 0
    const fetchImpl: typeof fetch = async () => {
      submits += 1
      return jsonResponse({ code: 'InvalidApiKey', message: 'No API-key provided.' }, 401)
    }
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-bad' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({ message: '阿里云百炼 API Key 无效', status: 502 })
    expect(submits).toBe(1)
  })

  it('查询结果时连接失败会重试，成功后继续', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 6, g: 6, b: 6 } },
    }).jpeg().toBuffer()
    const padding = { left: 10, right: 0, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(640, 640, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 7, g: 7, b: 7 } },
    }).jpeg().toBuffer()
    let polls = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-poll-retry', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-poll-retry')) {
        polls += 1
        if (polls === 1) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] } })
      }
      return new Response(model, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    expect(polls).toBe(2)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(650)
  })

  it('下载结果时连接失败会重试，成功后继续', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 8, g: 8, b: 8 } },
    }).jpeg().toBuffer()
    const padding = { left: 10, right: 0, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(640, 640, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).jpeg().toBuffer()
    let downloads = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-dl-retry', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-dl-retry')) {
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] } })
      }
      downloads += 1
      if (downloads < 2) throw Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' })
      return new Response(model, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    expect(downloads).toBe(2)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(650)
  })

  it('提交被 Abort 后不重试，避免重复建任务', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 1, g: 1, b: 1 } },
    }).jpeg().toBuffer()
    let submits = 0
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: async () => {
        submits += 1
        throw new DOMException('The operation was aborted', 'AbortError')
      },
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })).rejects.toMatchObject({
      message: '无法连接到阿里云百炼扩图服务，请稍后重试',
      status: 502,
      stage: 'submit',
    })
    expect(submits).toBe(1)
  })

  it('任务未完成时按新间隔轮询，并记下各阶段耗时', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 8, g: 8, b: 8 } },
    }).jpeg().toBuffer()
    const padding = { left: 20, right: 0, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(640, 640, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 9, g: 9, b: 9 } },
    }).jpeg().toBuffer()
    let polls = 0
    const sleeps: number[] = []
    const stages: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-poll', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-poll')) {
        polls += 1
        if (polls < 3) return jsonResponse({ output: { task_status: 'RUNNING' } })
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] } })
      }
      return new Response(model, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async ms => { sleeps.push(ms) },
      now: () => 0,
      requestId: 'req-timing',
      log: entry => { stages.push(String(entry.stage)) },
    })
    expect(sleeps).toEqual([400, 800, 800])
    expect(stages).toEqual(['plan', 'submit', 'poll', 'poll', 'poll', 'wait', 'download', 'crop', 'total'])
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(660)
    expect(meta.height).toBe(640)
  })

  it('超过 30 次轮询只要未到截止时间就继续等', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 10, g: 10, b: 10 } },
    }).jpeg().toBuffer()
    const padding = { left: 10, right: 0, top: 0, bottom: 0 }
    const plan = planBailianOutpaint(640, 640, padding)
    const model = await sharp({
      create: { width: plan.modelWidth, height: plan.modelHeight, channels: 3, background: { r: 11, g: 11, b: 11 } },
    }).jpeg().toBuffer()
    let polls = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-long-wait', task_status: 'PENDING' } })
      }
      if (url.endsWith('/tasks/task-long-wait')) {
        polls += 1
        if (polls < 35) return jsonResponse({ output: { task_status: 'RUNNING' } })
        return jsonResponse({ output: { task_status: 'SUCCEEDED', results: [{ url: 'https://example.test/out.jpg' }] } })
      }
      return new Response(model, { status: 200 })
    }
    const output = await expandWithBailian(source, padding, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async () => {},
      now: () => 0,
    })
    expect(polls).toBe(35)
    const meta = await sharp(output).metadata()
    expect(meta.width).toBe(650)
  })

  it('等到截止时间仍在 RUNNING 时带上 taskId 并说明阿里云还在处理', async () => {
    const source = await sharp({
      create: { width: 640, height: 640, channels: 3, background: { r: 12, g: 12, b: 12 } },
    }).jpeg().toBuffer()
    const logs: Array<Record<string, unknown>> = []
    let nowMs = 0
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/image-synthesis')) {
        return jsonResponse({ output: { task_id: 'task-still-running', task_status: 'PENDING' } })
      }
      return jsonResponse({ output: { task_status: 'RUNNING' } })
    }
    await expect(expandWithBailian(source, { left: 10, right: 0, top: 0, bottom: 0 }, {
      fetch: fetchImpl,
      env: { DASHSCOPE_API_KEY: 'sk-test' },
      sleep: async ms => { nowMs += ms },
      now: () => nowMs,
      deadlineMs: 40_000,
      requestId: 'req-wait-timeout',
      log: entry => { logs.push(entry) },
    })).rejects.toMatchObject({
      message: OUTPAINT_WAIT_TIMEOUT_MESSAGE,
      status: 504,
      code: 'OUTPAINT_TIMEOUT',
      stage: 'wait',
    })
    const wait = logs.find(entry => entry.stage === 'wait')
    expect(wait).toMatchObject({ taskId: 'task-still-running', done: false, requestId: 'req-wait-timeout' })
    expect(Number(wait?.ms)).toBeGreaterThan(0)
    expect(Number(wait?.ms)).toBeLessThanOrEqual(40_000)
  })
})
