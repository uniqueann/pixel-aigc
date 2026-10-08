import { describe, expect, it, vi } from 'vitest'
import { ProviderError } from '../types.js'
import { createQwenImageProvider, qwenAgentOptions, selectQwenFetch } from './client.js'
import { CONNECT_TIMEOUT_MS, defaultDashScopeFetch } from '../../dashscope.js'
import type { QwenImageSettings } from './config.js'
import {
  QWEN_END_TIME,
  QWEN_SCHEDULED_TIME,
  QWEN_SUBMIT_TIME,
  QWEN_TASK_ID,
  pollCanceled,
  pollFailedInternal,
  pollFailedModeration,
  pollPending,
  pollRunning,
  pollSucceededChoices,
  pollSucceededContentImages,
  pollSucceededContentUrl,
  pollSucceededData,
  pollSucceededOne,
  pollSucceededResults,
  pollUnknown,
  qwenImageUrl,
  submitInvalidKey,
  submitModeration,
  submitPending,
  submitThrottled,
} from './fixtures.js'

const settings: QwenImageSettings = {
  apiKey: 'sk-test',
  baseUrl: 'https://dashscope.aliyuncs.com',
  models: ['qwen-image-3.0', 'qwen-image-3.0-pro'],
  promptExtend: true,
  thinkingOverride: undefined,
  requestTimeoutMs: 30_000,
  connectTimeoutMs: 10_000,
  retryCount: 0,
  pollIntervalMs: 3_000,
  initialPollDelayMs: 5_000,
  taskTimeoutMs: 300_000,
  maxParallel: 1,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function context(fetchImpl: typeof fetch, sleep = vi.fn(async () => undefined)) {
  return { fetch: fetchImpl, sleep, now: () => 0, log: vi.fn(), requestId: 'req-1' }
}

const provider = createQwenImageProvider(() => settings)
const input = {
  model: 'qwen-image-3.0',
  prompt: '橙色香水瓶',
  images: [] as Array<{ url: string }>,
  providerParams: { size: '1328*1328', resolution: '1k', n: 4, batch: true },
}

describe('qwen image 客户端', () => {
  it('异步提交带 X-DashScope-Async，并读取 task_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    const ctx = context(fetchImpl)
    await expect(provider.submit!(input, ctx)).resolves.toEqual({ providerTaskId: QWEN_TASK_ID })
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://dashscope.aliyuncs.com/api/v1/services/aigc/image-generation/generation')
    expect(request.headers.Authorization).toBe('Bearer sk-test')
    expect(request.headers['X-DashScope-Async']).toBe('enable')
    expect(JSON.parse(request.body)).toEqual({
      model: 'qwen-image-3.0',
      input: { messages: [{ role: 'user', content: [{ text: '橙色香水瓶' }] }] },
      parameters: { size: '1328*1328', n: 4, prompt_extend: true, enable_thinking: false, watermark: false },
    })
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain('sk-test')
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'qwen-image-submit', enableThinking: false, promptExtend: true }))
  })

  it('请求可以打开思考，运维覆盖和关闭扩写优先', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    const asking = { ...input, providerParams: { ...input.providerParams, enableThinking: true } }
    await provider.submit!(asking, context(fetchImpl))
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).parameters.enable_thinking).toBe(true)

    const forcedOff = createQwenImageProvider(() => ({ ...settings, thinkingOverride: false }))
    const offFetch = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    await forcedOff.submit!(asking, context(offFetch))
    expect(JSON.parse(offFetch.mock.calls[0][1].body).parameters.enable_thinking).toBe(false)

    const forcedOn = createQwenImageProvider(() => ({ ...settings, thinkingOverride: true }))
    const onFetch = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    await forcedOn.submit!(input, context(onFetch))
    expect(JSON.parse(onFetch.mock.calls[0][1].body).parameters.enable_thinking).toBe(true)
  })

  it('参考图放在文字前面，带图时不发送 prompt_extend_mode', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    const images = [
      { url: 'https://r2.test/product.png' },
      { url: 'data:image/png;base64,aaaa' },
    ]
    await provider.submit!({ ...input, images }, context(fetchImpl))
    const body = JSON.parse(fetchImpl.mock.calls[0][1].body)
    expect(body.input.messages[0].content).toEqual([
      { image: images[0].url },
      { image: images[1].url },
      { text: input.prompt },
    ])
    expect(body.parameters).not.toHaveProperty('prompt_extend_mode')
    expect(body.parameters.prompt_extend).toBe(true)

    const tooMany = Array.from({ length: 4 }, (_, index) => ({ url: `https://r2.test/${index}.png` }))
    await expect(provider.submit!({ ...input, images: tooMany }, context(vi.fn())))
      .rejects.toMatchObject({ code: 'INVALID_PARAMS', message: '当前模型最多 3 张参考图' })
    const pro = createQwenImageProvider(() => settings)
    const wide = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    await pro.submit!({
      ...input,
      model: 'qwen-image-2.1-pro',
      images: Array.from({ length: 10 }, (_, index) => ({ url: `https://r2.test/${index}.png` })),
    }, context(wide))
    expect(JSON.parse(wide.mock.calls[0][1].body).input.messages[0].content).toHaveLength(11)
    await expect(pro.submit!({
      ...input,
      model: 'qwen-image-2.1-pro',
      images: Array.from({ length: 11 }, (_, index) => ({ url: `https://r2.test/${index}.png` })),
    }, context(vi.fn()))).rejects.toMatchObject({ message: '当前模型最多 10 张参考图' })
  })

  it('关闭扩写时不打开思考', async () => {
    const quiet = createQwenImageProvider(() => ({ ...settings, promptExtend: false, thinkingOverride: true }))
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitPending))
    await quiet.submit!({ ...input, providerParams: { ...input.providerParams, enableThinking: true } }, context(fetchImpl))
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).parameters).toMatchObject({
      prompt_extend: false, enable_thinking: false,
    })
  })

  it('缺少 task_id、参考图和密钥错误会失败', async () => {
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse({ output: { task_status: 'PENDING' } })))))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    const auth = vi.fn().mockResolvedValue(jsonResponse(submitInvalidKey, 401))
    await expect(provider.submit!(input, context(auth))).rejects.toMatchObject({ code: 'INVALID_KEY', retryable: false })
    expect(auth).toHaveBeenCalledTimes(1)
  })

  it('提交时的内容审核不可重试', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitModeration, 400))
    await expect(provider.submit!(input, context(fetchImpl))).rejects.toMatchObject({
      code: 'CONTENT_REJECTED', message: '内容未通过审核', retryable: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('提交限流不在请求内重试，并记下上游错误码', async () => {
    const retrying = createQwenImageProvider(() => ({ ...settings, retryCount: 2 }))
    const sleep = vi.fn(async () => undefined)
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitThrottled, 429))
    const ctx = context(fetchImpl, sleep)
    await expect(retrying.submit!(input, ctx)).rejects.toMatchObject({
      code: 'RATE_LIMIT', retryable: true, holdPending: true,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'qwen-image-submit',
      status: 429,
      retry: false,
      upstreamCode: 'Throttling.RateQuota',
      upstreamMessage: 'Requests rate limit exceeded.',
    }))
  })

  it('AllocationQuota 不排队，也不在请求内重试', async () => {
    const retrying = createQwenImageProvider(() => ({ ...settings, retryCount: 2 }))
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 'Throttling.AllocationQuota',
      message: 'Allocated quota exceeded, please increase your quota limit.',
      request_id: 'req-quota',
    }, 429))
    await expect(retrying.submit!(input, context(fetchImpl))).rejects.toMatchObject({
      code: 'RATE_LIMIT', retryable: false, holdPending: undefined,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('预览可以强制限流且不打上游，生产环境忽略该开关', async () => {
    const previous = {
      VERCEL_ENV: process.env.VERCEL_ENV,
      AIGC_RUNTIME_SCOPE: process.env.AIGC_RUNTIME_SCOPE,
      QWEN_IMAGE_FORCE_THROTTLE: process.env.QWEN_IMAGE_FORCE_THROTTLE,
    }
    try {
      process.env.VERCEL_ENV = 'preview'
      process.env.AIGC_RUNTIME_SCOPE = 'preview'
      process.env.QWEN_IMAGE_FORCE_THROTTLE = 'true'
      const blocked = vi.fn()
      const ctx = context(blocked)
      await expect(provider.submit!(input, ctx)).rejects.toMatchObject({ holdPending: true, code: 'RATE_LIMIT' })
      expect(blocked).not.toHaveBeenCalled()
      expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
        stage: 'qwen-image-submit', upstreamCode: 'Throttling.RateQuota', forcedThrottle: 'rate',
      }))

      process.env.QWEN_IMAGE_FORCE_THROTTLE = 'quota'
      const quota = vi.fn()
      await expect(provider.submit!(input, context(quota))).rejects.toMatchObject({
        retryable: false, holdPending: undefined,
      })
      expect(quota).not.toHaveBeenCalled()

      process.env.VERCEL_ENV = 'production'
      process.env.QWEN_IMAGE_FORCE_THROTTLE = 'true'
      const live = vi.fn().mockResolvedValue(jsonResponse(submitPending))
      await expect(provider.submit!(input, context(live))).resolves.toEqual({ providerTaskId: QWEN_TASK_ID })
      expect(live).toHaveBeenCalledTimes(1)
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })

  it('轮询把 PENDING/RUNNING 视为进行中，SUCCEEDED 读出图片和 usage', async () => {
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollPending)))))
      .resolves.toMatchObject({ state: 'queued', raw: 'PENDING' })
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollRunning)))))
      .resolves.toMatchObject({ state: 'processing', raw: 'RUNNING' })
    const ctx = context(vi.fn().mockResolvedValue(jsonResponse(pollSucceededOne)))
    const done = await provider.getStatus!(QWEN_TASK_ID, ctx)
    expect(done).toEqual({
      state: 'succeeded',
      resultUrls: [qwenImageUrl(0)],
      vendor: {
        outputWidth: 1328,
        outputHeight: 1328,
        outputImageCount: 1,
        outputImageType: 'qima_output_1k',
        inputImageCount: 0,
        inputImageType: 'qima_input_1k',
        submitTime: QWEN_SUBMIT_TIME,
        scheduledTime: QWEN_SCHEDULED_TIME,
        endTime: QWEN_END_TIME,
        imageShape: 'choices-content-image',
      },
    })
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'qwen-image-status',
      raw: 'SUCCEEDED',
      imageShape: 'choices-content-image',
      submitTime: QWEN_SUBMIT_TIME,
      scheduledTime: QWEN_SCHEDULED_TIME,
      endTime: QWEN_END_TIME,
    }))
    const running = context(vi.fn().mockResolvedValue(jsonResponse(pollRunning)))
    await provider.getStatus!(QWEN_TASK_ID, running)
    expect(running.log).toHaveBeenCalledWith(expect.objectContaining({
      raw: 'RUNNING',
      submitTime: QWEN_SUBMIT_TIME,
      scheduledTime: QWEN_SCHEDULED_TIME,
    }))
  })

  it('多图同时接受一个 content 数组和多个 choice，并记下命中的字段', async () => {
    for (const body of [pollSucceededContentImages(4), pollSucceededChoices(4)]) {
      const state = await provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(body))))
      expect(state).toMatchObject({
        state: 'succeeded',
        resultUrls: [0, 1, 2, 3].map(qwenImageUrl),
        vendor: { imageShape: 'choices-content-image' },
      })
    }
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollSucceededContentUrl)))))
      .resolves.toMatchObject({ vendor: { imageShape: 'choices-content-url' }, resultUrls: [qwenImageUrl(0)] })
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollSucceededResults)))))
      .resolves.toMatchObject({ vendor: { imageShape: 'output-results' }, resultUrls: [qwenImageUrl(0), qwenImageUrl(1)] })
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollSucceededData)))))
      .resolves.toMatchObject({ vendor: { imageShape: 'data' }, resultUrls: [qwenImageUrl(0)] })
  })

  it('任务失败、审核拒绝和取消都是终态', async () => {
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollFailedModeration)))))
      .resolves.toMatchObject({ state: 'failed', code: 'CONTENT_REJECTED', message: '内容未通过审核', retryable: false })
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollFailedInternal)))))
      .resolves.toMatchObject({ state: 'failed', code: 'UPSTREAM_UNAVAILABLE', retryable: false })
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollCanceled)))))
      .resolves.toMatchObject({ state: 'failed', message: '图片任务已取消', retryable: false })
  })

  it('UNKNOWN 继续查询，不把可能还在排队的任务立刻判失败', async () => {
    await expect(provider.getStatus!(QWEN_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollUnknown)))))
      .resolves.toMatchObject({ state: 'processing', raw: 'UNKNOWN' })
  })

  it('建连超时记下原因码，并且请求还没送出', async () => {
    const connectTimeout = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT', name: 'ConnectTimeoutError' }),
    })
    const retrying = createQwenImageProvider(() => ({ ...settings, retryCount: 2 }))
    const fetchImpl = vi.fn().mockRejectedValue(connectTimeout)
    const ctx = context(fetchImpl)
    await expect(retrying.submit!(input, ctx)).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE', retryable: true, requestSent: false,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'qwen-image-submit', error: 'fetch failed', errorCode: 'UND_ERR_CONNECT_TIMEOUT',
    }))
    const reset = new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    const resetFetch = vi.fn().mockRejectedValue(reset)
    await expect(provider.submit!(input, context(resetFetch))).rejects.toMatchObject({
      code: 'UPSTREAM_UNAVAILABLE', requestSent: undefined,
    })
    expect(resetFetch).toHaveBeenCalledTimes(1)
  })

  it('生产 fetch 使用 10 秒建连，不复用百炼 4 秒客户端', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(4_000)
    expect(qwenAgentOptions(10_000).connectTimeout).toBe(10_000)
    const injected = vi.fn() as unknown as typeof fetch
    expect(selectQwenFetch(injected, 10_000)).toBe(injected)
    expect(selectQwenFetch(globalThis.fetch, 10_000)).not.toBe(defaultDashScopeFetch)
  })

  it('请求超时映射为可重试的 TIMEOUT', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    const fetchImpl = vi.fn().mockRejectedValue(timeout)
    await expect(provider.submit!(input, context(fetchImpl))).rejects.toMatchObject({
      code: 'TIMEOUT', retryable: true, status: 504,
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await expect(provider.submit!(input, context(fetchImpl))).rejects.toBeInstanceOf(ProviderError)
  })

  it('jobPolicy 使用千问自己的轮询参数', () => {
    expect(provider.jobPolicy?.()).toEqual({
      taskTimeoutMs: 300_000,
      pollIntervalMs: 3_000,
      initialPollDelayMs: 5_000,
      maxParallel: 1,
    })
  })
})
