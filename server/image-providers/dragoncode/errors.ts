import { ProviderError } from '../types.js'
import { providerErrorFromMessage } from '../http.js'

export function dragonCodeFailure(message: string, raw?: unknown) {
  const error = providerErrorFromMessage(message || '图片生成失败')
  if (raw !== undefined) {
    console.info(JSON.stringify({
      evt: 'dragoncode',
      stage: 'failure',
      code: error.code,
      message: error.message,
      payload: sanitizePayload(raw),
    }))
  }
  return error
}

export function sanitizePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return redactUrls(payload).slice(0, 800)
  if (!payload || typeof payload !== 'object') return payload
  if (Array.isArray(payload)) return payload.slice(0, 8).map(sanitizePayload)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    result[key] = typeof value === 'string' ? redactUrls(value).slice(0, 400) : sanitizePayload(value)
  }
  return result
}

function redactUrls(value: string) {
  return value.replace(/https?:\/\/[^\s"'\\]+/g, match => {
    try {
      return new URL(match).host
    } catch {
      return '[url]'
    }
  })
}

export function missingTaskError() {
  return new ProviderError('BAD_RESPONSE', '图片服务没有返回任务编号', false, 502)
}
