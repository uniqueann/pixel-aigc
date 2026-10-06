import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError } from '../types.js'
import { createDragonCodeProvider } from './client.js'
import {
  USER_AUTH_FAILURE,
  USER_CONTENT_REJECTED,
  USER_GENERIC_FAILURE,
  USER_NOT_FOUND,
} from './errors.js'
import {
  FAKE_MEDIA_TOKEN,
  FAKE_MEDIA_URL,
  FAKE_TASK_ID,
  authApiKeyRequired,
  authInvalidApiKey,
  pollCompleted1k,
  pollFailedUnsupportedMime,
  pollFailedUpstream,
  pollPending,
  pollPendingProgress5,
  pollProcessing,
  submitSuccess,
  taskNotFound,
  validationNNotOne,
  validationUnreachableImage,
} from './fixtures.js'

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://dragoncode.codes/gpt-image/v1',
  model: 'gpt-image-2',
  requestTimeoutMs: 30_000,
  retryCount: 2,
  pollIntervalMs: 5_000,
  initialPollDelayMs: 5_000,
  taskTimeoutMs: 300_000,
  maxParallel: 4,
}

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

function context(fetchImpl: typeof fetch, sleep = vi.fn(async () => undefined)) {
  return {
    fetch: fetchImpl,
    sleep,
    now: () => 0,
    log: vi.fn(),
    requestId: 'req-1',
  }
}

const provider = createDragonCodeProvider(() => config)
const input = {
  model: 'gpt-image-2',
  prompt: '换成白底',
  images: [{ url: 'https://files.example/source.png?X-Amz-Expires=3600&X-Amz-Signature=fake' }],
  providerParams: { size: '3:2', resolution: '2k', n: 1 },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DragonCode 客户端', () => {
  it('文生图省略 image_urls，仍调用现有图片生成接口', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitSuccess))
    await provider.submit!({ ...input, prompt: '浅色木桌上的香水瓶', images: [] }, context(fetchImpl))
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://dragoncode.codes/gpt-image/v1/images/generations')
    expect(JSON.parse(request.body)).toEqual({ model: 'gpt-image-2', prompt: '浅色木桌上的香水瓶', n: 1, size: '3:2', resolution: '2k' })
  })

  it('提交时映射为官方 JSON，并从 data[0].task_id 读取任务号', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(submitSuccess, 200, { 'X-Request-Id': 'dc-submit-1' }))
    const ctx = context(fetchImpl)
    const result = await provider.submit!(input, ctx)
    expect(result).toEqual({ providerTaskId: FAKE_TASK_ID })
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://dragoncode.codes/gpt-image/v1/images/generations')
    expect(request.headers.Authorization).toBe('Bearer test-key')
    expect(JSON.parse(request.body)).toEqual({
      model: 'gpt-image-2',
      prompt: '换成白底',
      n: 1,
      size: '3:2',
      resolution: '2k',
      image_urls: [input.images[0].url],
    })
    expect(ctx.log.mock.calls.some(call => call[0].upstreamRequestId === 'dc-submit-1' || call[0].stage === 'dragoncode-source')).toBe(true)
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'dragoncode-source',
      kind: 'url',
      signedQueryParamNames: expect.arrayContaining(['X-Amz-Expires', 'X-Amz-Signature']),
    }))
  })

  it('缺少 data[0].task_id 时失败', async () => {
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse({
      code: 200, data: [{ status: 'submitted' }],
    }))))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('查询时 pending/processing/未知状态都视为进行中，并忽略 estimated_time', async () => {
    for (const body of [pollPending, pollPendingProgress5, pollProcessing]) {
      const state = await provider.getStatus!(FAKE_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(body))))
      expect(state).toMatchObject({ state: 'processing', progress: body.data.progress, raw: body.data.status })
      expect(state).not.toHaveProperty('eta')
    }
    const mystery = await provider.getStatus!(FAKE_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse({
      code: 200, data: { status: 'mystery', progress: 7, estimated_time: 100 },
    }))))
    expect(mystery).toMatchObject({ state: 'processing', raw: 'mystery', progress: 7 })
  })

  it('完成时读取 result.images[0].url[0]，并持久化 cost / credits_cost', async () => {
    const ctx = context(vi.fn().mockResolvedValue(jsonResponse(pollCompleted1k, 200, { 'X-Request-Id': 'dc-poll-1' })))
    const state = await provider.getStatus!(FAKE_TASK_ID, ctx)
    expect(state).toEqual({
      state: 'succeeded',
      resultUrls: [FAKE_MEDIA_URL],
      vendor: { cost: 0.0085, creditsCost: 1, expiresAt: 1_759_116_436 },
    })
    const logged = JSON.stringify(ctx.log.mock.calls)
    expect(logged).not.toContain(FAKE_MEDIA_TOKEN)
    expect(logged).toContain('dragoncode.codes/gpt-image/media')
  })

  it('HTTP 200 + status=failed 时清洗上游原文，只给用户通用错误', async () => {
    const ctx = context(vi.fn().mockResolvedValue(jsonResponse(pollFailedUpstream)))
    await expect(provider.getStatus!(FAKE_TASK_ID, ctx)).resolves.toMatchObject({
      state: 'failed',
      code: 'CONTENT_REJECTED',
      message: USER_CONTENT_REJECTED,
      retryable: false,
      vendor: { cost: 0, creditsCost: 0 },
    })
    const logged = JSON.stringify(ctx.log.mock.calls)
    expect(logged).toContain('upstream_error')
    expect(logged).not.toContain(FAKE_MEDIA_TOKEN)
  })

  it('非图片 data URI 在提交前拒绝，避免 14-35s 后才 200+failed', async () => {
    const fetchImpl = vi.fn()
    await expect(provider.submit!({
      ...input,
      images: [{ url: 'data:text/plain;base64,aGVsbG8=' }],
    }, context(fetchImpl))).rejects.toMatchObject({ code: 'INVALID_PARAMS', message: '参考图必须是图片格式' })
    expect(fetchImpl).not.toHaveBeenCalled()
    await expect(provider.getStatus!(FAKE_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(pollFailedUnsupportedMime))))).resolves.toMatchObject({
      state: 'failed',
      message: USER_GENERIC_FAILURE,
      vendor: { cost: 0 },
    })
  })

  it('401 扁平 {code,message} 视为不可重试的配置错误并告警', async () => {
    const ctx = context(vi.fn().mockResolvedValue(jsonResponse(authInvalidApiKey, 401, { 'X-Request-Id': 'dc-401' })))
    await expect(provider.submit!(input, ctx)).rejects.toMatchObject({
      code: 'INVALID_KEY', message: USER_AUTH_FAILURE, retryable: false, status: 401,
    })
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      alert: true, kind: 'provider-auth', status: 401, upstreamRequestId: 'dc-401',
    }))
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse(authApiKeyRequired, 401))))).rejects.toMatchObject({
      code: 'INVALID_KEY', retryable: false,
    })
  })

  it('400 {error:{...}} 为不可重试的非法请求', async () => {
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse(validationNNotOne, 400))))).rejects.toMatchObject({
      code: 'INVALID_PARAMS', message: '当前模型每次只能生成 1 张', retryable: false, status: 400,
    })
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse(validationUnreachableImage, 400))))).rejects.toMatchObject({
      code: 'INVALID_PARAMS', message: '参考图地址无法访问', retryable: false,
    })
  })

  it('404 未知任务为不可重试', async () => {
    await expect(provider.getStatus!(FAKE_TASK_ID, context(vi.fn().mockResolvedValue(jsonResponse(taskNotFound, 404))))).rejects.toMatchObject({
      code: 'BAD_RESPONSE', message: USER_NOT_FOUND, retryable: false, status: 404,
    })
  })

  it('408/429/5xx 会指数退避重试，4xx 不会', async () => {
    const sleep = vi.fn(async () => undefined)
    const retryFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'slow' }, 408))
      .mockResolvedValueOnce(jsonResponse({ message: 'busy' }, 429))
      .mockResolvedValueOnce(jsonResponse(submitSuccess))
    await expect(provider.submit!(input, context(retryFetch, sleep))).resolves.toEqual({ providerTaskId: FAKE_TASK_ID })
    expect(retryFetch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(sleep).toHaveBeenNthCalledWith(2, 2000)

    const clientError = vi.fn().mockResolvedValue(jsonResponse({ error: { message: 'bad prompt', type: 'invalid_request_error' } }, 400))
    await expect(provider.submit!(input, context(clientError, sleep))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(clientError).toHaveBeenCalledTimes(1)
  })

  it('超时映射为 504 TIMEOUT', async () => {
    const timeout = Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })
    const fetchImpl = vi.fn().mockRejectedValue(timeout)
    await expect(provider.submit!(input, context(fetchImpl))).rejects.toMatchObject({
      code: 'TIMEOUT', status: 504,
    })
  })

  it('jobPolicy 跟随 DragonCode 配置，而不是别的供应商', () => {
    expect(provider.jobPolicy?.()).toEqual({
      taskTimeoutMs: 300_000,
      pollIntervalMs: 5_000,
      initialPollDelayMs: 5_000,
      maxParallel: 4,
    })
  })

  it('下载非 image/* 时报错，且日志不含 token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not-image', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    const ctx = context(fetchImpl)
    await expect(provider.fetchResult(FAKE_MEDIA_URL, ctx)).rejects.toBeInstanceOf(ProviderError)
    await expect(provider.fetchResult(FAKE_MEDIA_URL, ctx)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain(FAKE_MEDIA_TOKEN)
  })
})
