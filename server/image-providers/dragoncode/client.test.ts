import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProviderError } from '../types.js'
import { createDragonCodeProvider } from './client.js'

const config = {
  apiKey: 'test-key',
  baseUrl: 'https://dragoncode.codes/gpt-image/v1',
  model: 'gpt-image-2',
  requestTimeoutMs: 30_000,
  retryCount: 2,
  pollIntervalMs: 5_000,
  initialPollDelayMs: 10_000,
  taskTimeoutMs: 300_000,
  maxParallel: 4,
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
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
  images: [{ url: 'https://files.example/source.png' }],
  providerParams: { size: '3:2', resolution: '2k', n: 1 },
}

afterEach(() => {
  vi.useRealTimers()
})

describe('DragonCode 客户端', () => {
  it('提交时映射为官方 JSON，并读取 task_id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: [{ status: 'submitted', task_id: 'task-88' }],
    }))
    const result = await provider.submit!(input, context(fetchImpl))
    expect(result).toEqual({ providerTaskId: 'task-88' })
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://dragoncode.codes/gpt-image/v1/images/generations')
    expect(request.headers.Authorization).toBe('Bearer test-key')
    expect(JSON.parse(request.body)).toEqual({
      model: 'gpt-image-2',
      prompt: '换成白底',
      n: 1,
      size: '3:2',
      resolution: '2k',
      image_urls: ['https://files.example/source.png'],
    })
  })

  it('code 非 200 或缺少 task_id 时失败', async () => {
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse({
      code: 400, message: 'size invalid',
    }))))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(provider.submit!(input, context(vi.fn().mockResolvedValue(jsonResponse({
      code: 200, data: [{ status: 'submitted' }],
    }))))).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })

  it('查询时 submitted / pending / 未知状态都视为进行中', async () => {
    for (const status of ['submitted', 'pending', 'running', 'mystery']) {
      const ctx = context(vi.fn().mockResolvedValue(jsonResponse({
        code: 200, data: { id: 't', status, progress: 40 },
      })))
      await expect(provider.getStatus!('t', ctx)).resolves.toMatchObject({ state: 'processing', raw: status })
    }
  })

  it('完成时遍历全部结果 URL', async () => {
    const state = await provider.getStatus!('t', context(vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: {
        id: 't',
        status: 'completed',
        result: { images: [{ url: ['https://cdn.example/a.png', 'https://cdn.example/b.png'] }, { url: ['https://cdn.example/c.png'] }] },
      },
    }))))
    expect(state).toEqual({
      state: 'succeeded',
      resultUrls: ['https://cdn.example/a.png', 'https://cdn.example/b.png', 'https://cdn.example/c.png'],
    })
  })

  it('失败时读取 error.message 并记录原始载荷', async () => {
    const ctx = context(vi.fn().mockResolvedValue(jsonResponse({
      code: 200,
      data: { id: 't', status: 'failed', error: { message: '内容审核未通过' } },
    })))
    await expect(provider.getStatus!('t', ctx)).resolves.toMatchObject({
      state: 'failed', code: 'CONTENT_REJECTED', message: '内容审核未通过',
    })
    expect(ctx.log).toHaveBeenCalled()
  })

  it('408/429/5xx 会重试，4xx 不会', async () => {
    const sleep = vi.fn(async () => undefined)
    const retryFetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ message: 'slow' }, 408))
      .mockResolvedValueOnce(jsonResponse({ message: 'busy' }, 429))
      .mockResolvedValueOnce(jsonResponse({ code: 200, data: [{ task_id: 'ok' }] }))
    await expect(provider.submit!(input, context(retryFetch, sleep))).resolves.toEqual({ providerTaskId: 'ok' })
    expect(retryFetch).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenNthCalledWith(1, 1000)
    expect(sleep).toHaveBeenNthCalledWith(2, 2000)

    const clientError = vi.fn().mockResolvedValue(jsonResponse({ message: 'bad prompt' }, 400))
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

  it('下载非 image/* 时报错', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('not-image', {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
    await expect(provider.fetchResult('https://cdn.example/a.json', context(fetchImpl)))
      .rejects.toBeInstanceOf(ProviderError)
    await expect(provider.fetchResult('https://cdn.example/a.json', context(fetchImpl)))
      .rejects.toMatchObject({ code: 'BAD_RESPONSE' })
  })
})
