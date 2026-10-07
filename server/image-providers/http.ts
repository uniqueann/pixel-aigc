import { ProviderError, type ProviderContext, type ProviderErrorCode } from './types.js'

export const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

export function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

export function retryBackoffMs(attempt: number) {
  return Math.min(5000, 1000 * 2 ** attempt)
}

export function requestHost(url: string) {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}

export function isAbortOrTimeout(error: unknown) {
  if (!(error instanceof Error)) return false
  return error.name === 'AbortError' || error.name === 'TimeoutError' || /aborted|timeout/i.test(error.message)
}

function readMessage(payload: unknown) {
  if (!payload || typeof payload !== 'object') return ''
  const record = payload as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.trim()) return record.message.trim()
  const error = record.error
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return String((error as { message: string }).message).trim()
  }
  return ''
}

export function mapHttpStatus(status: number, message: string): ProviderError {
  if (status === 401 || status === 403) {
    return new ProviderError('INVALID_KEY', message || '图片服务密钥无效', false, status)
  }
  if (status === 402) return new ProviderError('INSUFFICIENT_BALANCE', '图片服务余额不足', false, 402)
  if (status === 429) return new ProviderError('RATE_LIMIT', message || '图片服务请求过于频繁，请稍后重试', true, 429)
  if (status === 408 || status === 504) {
    return new ProviderError('TIMEOUT', message || '图片服务请求超时，请稍后重试', true, 504)
  }
  if (status === 404) {
    return new ProviderError('BAD_RESPONSE', message || '图片任务不存在或已过期', false, 404)
  }
  if (status >= 500) {
    return new ProviderError('UPSTREAM_UNAVAILABLE', message || '图片服务暂时不可用，请稍后重试', true, 502)
  }
  return new ProviderError('INVALID_PARAMS', message || '图片服务拒绝了当前请求', false, status >= 400 ? status : 400)
}

function headerRequestId(headers: Headers) {
  return headers.get('x-request-id') ?? headers.get('X-Request-Id') ?? undefined
}

export async function fetchJson(
  url: string,
  init: RequestInit,
  ctx: ProviderContext,
  options: { timeoutMs: number; retryCount: number; label: string },
): Promise<{ status: number; payload: unknown; upstreamRequestId?: string }> {
  let lastError: unknown
  for (let attempt = 0; attempt <= options.retryCount; attempt += 1) {
    const started = ctx.now()
    try {
      const response = await ctx.fetch(url, {
        ...init,
        signal: ctx.signal ?? AbortSignal.timeout(options.timeoutMs),
      })
      const payload: unknown = await response.json().catch(() => null)
      const upstreamRequestId = headerRequestId(response.headers)
      const retry = RETRYABLE_STATUS.has(response.status) && attempt < options.retryCount
      const authAlert = response.status === 401 || response.status === 403
      ctx.log({
        stage: options.label, attempt, status: response.status, retry,
        host: requestHost(url), ms: ctx.now() - started, requestId: ctx.requestId,
        upstreamRequestId, ...(authAlert ? { alert: true, kind: 'provider-auth' } : {}),
      })
      if (authAlert && !process.env.VITEST) {
        console.error(JSON.stringify({
          evt: 'dragoncode', alert: true, kind: 'provider-auth',
          stage: options.label, status: response.status, upstreamRequestId,
        }))
      }
      if (retry) {
        await ctx.sleep(retryBackoffMs(attempt))
        continue
      }
      if (!response.ok) throw mapHttpStatus(response.status, readMessage(payload))
      return { status: response.status, payload, upstreamRequestId }
    } catch (error) {
      lastError = error
      if (error instanceof ProviderError) {
        if (error.retryable && attempt < options.retryCount) {
          await ctx.sleep(retryBackoffMs(attempt))
          continue
        }
        throw error
      }
      const timeout = isAbortOrTimeout(error)
      ctx.log({
        stage: options.label, attempt, retry: timeout && attempt < options.retryCount,
        host: requestHost(url), ms: ctx.now() - started, requestId: ctx.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      if (timeout && attempt < options.retryCount) {
        await ctx.sleep(retryBackoffMs(attempt))
        continue
      }
      throw new ProviderError(
        timeout ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        timeout ? '图片服务请求超时，请稍后重试' : '图片服务连接失败，请稍后重试',
        timeout,
        timeout ? 504 : 502,
      )
    }
  }
  throw lastError instanceof ProviderError
    ? lastError
    : new ProviderError('UPSTREAM_UNAVAILABLE', '图片服务连接失败，请稍后重试')
}

export async function fetchImageBytes(
  url: string,
  ctx: ProviderContext,
  timeoutMs: number,
): Promise<{ bytes: Uint8Array; mimeType: string }> {
  const started = ctx.now()
  let response: Response
  try {
    // DragonCode media: token 必填；HEAD 返回 404；Range 被忽略。只用普通 GET。
    response = await ctx.fetch(url, { signal: ctx.signal ?? AbortSignal.timeout(timeoutMs) })
  } catch (error) {
    const timeout = isAbortOrTimeout(error)
    throw new ProviderError(
      timeout ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
      timeout ? '结果图片下载超时' : '结果图片下载失败',
      timeout,
      timeout ? 504 : 502,
    )
  }
  ctx.log({
    stage: 'download', status: response.status, host: requestHost(url),
    ms: ctx.now() - started, requestId: ctx.requestId,
    upstreamRequestId: headerRequestId(response.headers),
  })
  if (!response.ok) throw new ProviderError('BAD_RESPONSE', '结果图片下载失败', response.status >= 500, 502)
  const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? ''
  if (!mimeType.startsWith('image/')) {
    throw new ProviderError('BAD_RESPONSE', '结果不是有效图片', false, 502)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!bytes.byteLength) throw new ProviderError('BAD_RESPONSE', '结果图片为空', false, 502)
  return { bytes, mimeType }
}

export function providerErrorFromMessage(message: string, fallback: ProviderErrorCode = 'UNKNOWN'): ProviderError {
  const text = message.replace(/\s+/g, ' ').trim()
  if (/审核|违规|content.?policy|safety|nsfw|moderat/i.test(text)) {
    return new ProviderError('CONTENT_REJECTED', text || '内容未通过审核', false, 400)
  }
  if (/4k|resolution|ratio|aspect|size|invalid|参数/i.test(text)) {
    return new ProviderError('INVALID_PARAMS', text || '图片参数不被支持', false, 400)
  }
  if (/balance|欠费|余额|insufficient/i.test(text)) {
    return new ProviderError('INSUFFICIENT_BALANCE', text || '图片服务余额不足', false, 402)
  }
  return new ProviderError(fallback, text || '图片生成失败', false, 502)
}
