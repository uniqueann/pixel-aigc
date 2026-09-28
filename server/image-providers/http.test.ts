import { describe, expect, it, vi } from 'vitest'
import { fetchJson, mapHttpStatus, retryBackoffMs } from './http.js'

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  })
}

describe('供应商 HTTP', () => {
  it('429/5xx 指数退避，401/400 不重试', () => {
    expect(retryBackoffMs(0)).toBe(1000)
    expect(retryBackoffMs(1)).toBe(2000)
    expect(retryBackoffMs(2)).toBe(4000)
    expect(retryBackoffMs(8)).toBe(5000)
    expect(mapHttpStatus(401, 'Invalid API key')).toMatchObject({ code: 'INVALID_KEY', retryable: false })
    expect(mapHttpStatus(400, 'only supports n=1')).toMatchObject({ code: 'INVALID_PARAMS', retryable: false })
    expect(mapHttpStatus(429, 'busy')).toMatchObject({ code: 'RATE_LIMIT', retryable: true })
    expect(mapHttpStatus(503, 'down')).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: true })
  })

  it('记录上游 X-Request-Id，401 打 alert', async () => {
    const ctx = {
      fetch: vi.fn().mockResolvedValue(jsonResponse({ code: 'INVALID_API_KEY', message: 'Invalid API key' }, 401, {
        'X-Request-Id': 'dc-auth-9',
      })),
      sleep: vi.fn(async () => undefined),
      now: () => 1,
      log: vi.fn(),
      requestId: 'req-1',
    }
    await expect(fetchJson('https://dragoncode.codes/gpt-image/v1/images/generations', {
      method: 'POST',
    }, ctx, { timeoutMs: 1000, retryCount: 0, label: 'dragoncode-submit' })).rejects.toMatchObject({
      code: 'INVALID_KEY', status: 401,
    })
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      upstreamRequestId: 'dc-auth-9', alert: true, kind: 'provider-auth', status: 401,
    }))
  })
})
