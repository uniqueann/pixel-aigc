import { ProviderError, type ProviderErrorCode } from '../types.js'

export const USER_GENERIC_FAILURE = '图片生成失败，请稍后重试'
export const USER_AUTH_FAILURE = '图片服务密钥无效或尚未配置'
export const USER_INVALID_REQUEST = '图片服务拒绝了当前请求'
export const USER_NOT_FOUND = '图片任务不存在或已过期'
export const USER_RATE_LIMIT = '图片服务请求过于频繁，请稍后重试'
export const USER_CONTENT_REJECTED = '内容未通过审核'

const VALIDATION_ALIASES: Array<[RegExp, string]> = [
  [/only supports n\s*=\s*1/i, '当前模型每次只能生成 1 张'],
  [/model.*gpt-image-2|gpt-image-2/i, '当前仅支持 gpt-image-2 模型'],
  [/invalid size|size invalid/i, '图片尺寸不被支持'],
  [/4k/i, '该比例不支持 4K，请改用 2K 或更换比例'],
  [/missing prompt/i, '请填写编辑要求'],
  [/dns resolution failed|invalid image_urls/i, '参考图地址无法访问'],
  [/data URI image exceeds/i, '参考图超过 20MB 限制'],
  [/GPT-Image task not found|not_found_error/i, USER_NOT_FOUND],
]

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function isUpstreamDump(message: string) {
  return /upstream_error|chatgpt upstream|openai|chatcmpl-|raw dump/i.test(message)
}

export function friendlyValidationMessage(message: string) {
  const text = message.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  for (const [pattern, label] of VALIDATION_ALIASES) {
    if (pattern.test(text)) return label
  }
  return undefined
}

export function sanitizeUserFacingMessage(message: string, fallback = USER_GENERIC_FAILURE) {
  const text = message.replace(/\s+/g, ' ').trim()
  if (!text || isUpstreamDump(text) || text.length > 180) return fallback
  return friendlyValidationMessage(text) ?? text
}

export function redactSensitive(value: string) {
  return value
    .replace(/([?&]token=)[0-9a-fA-F]{8,}/gi, '$1[redacted]')
    .replace(/https?:\/\/[^\s"'\\]+/g, match => {
      try {
        const url = new URL(match)
        if (url.searchParams.has('token') || /\/gpt-image\/media\//i.test(url.pathname)) {
          return `${url.host}${url.pathname}`
        }
        return url.host
      } catch {
        return '[url]'
      }
    })
}

export function sanitizePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return redactSensitive(payload).slice(0, 800)
  if (!payload || typeof payload !== 'object') return payload
  if (Array.isArray(payload)) return payload.slice(0, 8).map(sanitizePayload)
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (key === 'token' || /signature|secret|api[_-]?key/i.test(key)) {
      result[key] = '[redacted]'
      continue
    }
    result[key] = typeof value === 'string' ? redactSensitive(value).slice(0, 400) : sanitizePayload(value)
  }
  return result
}

function readWrappedError(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.error)) return undefined
  return payload.error
}

function readFlatMessage(payload: unknown) {
  if (!isRecord(payload)) return ''
  const wrapped = readWrappedError(payload)
  return asString(wrapped?.message) ?? asString(payload.message) ?? ''
}

export function readNumericCode(payload: unknown) {
  return isRecord(payload) && typeof payload.code === 'number' ? payload.code : undefined
}

export function readSubmitTaskId(payload: unknown) {
  if (!isRecord(payload)) return undefined
  const data = payload.data
  if (Array.isArray(data) && isRecord(data[0])) return asString(data[0].task_id)
  return undefined
}

export function readStatusData(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.data)) return undefined
  return payload.data
}

export function readResultUrls(data: Record<string, unknown>) {
  const result = isRecord(data.result) ? data.result : undefined
  const images = Array.isArray(result?.images) ? result.images : []
  const urls: string[] = []
  for (const image of images) {
    if (!isRecord(image)) continue
    if (Array.isArray(image.url)) {
      for (const url of image.url) if (typeof url === 'string' && url) urls.push(url)
    }
  }
  return urls
}

export function readVendorUsage(data?: Record<string, unknown>) {
  if (!data) return undefined
  const cost = asFiniteNumber(data.cost)
  const creditsCost = asFiniteNumber(data.credits_cost)
  const expiresAt = asFiniteNumber(data.expires_at) ?? asString(data.expires_at)
  if (cost === undefined && creditsCost === undefined && expiresAt === undefined) return undefined
  return { cost, creditsCost, expiresAt }
}

export function classifyFailedTask(rawMessage: string) {
  if (/审核|违规|content.?policy|safety|nsfw|moderat/i.test(rawMessage)) {
    return new ProviderError('CONTENT_REJECTED', USER_CONTENT_REJECTED, false, 400)
  }
  return new ProviderError('UNKNOWN', USER_GENERIC_FAILURE, false, 502)
}

export function sanitizeProviderError(error: ProviderError) {
  if (error.code === 'INVALID_KEY') {
    return new ProviderError(error.code, USER_AUTH_FAILURE, false, error.status || 401)
  }
  if (error.code === 'RATE_LIMIT') {
    return new ProviderError(error.code, USER_RATE_LIMIT, true, 429)
  }
  if (isUpstreamDump(error.message)) {
    return new ProviderError(error.code, USER_GENERIC_FAILURE, error.retryable, error.status)
  }
  const friendly = friendlyValidationMessage(error.message)
  if (friendly) return new ProviderError(error.code, friendly, error.retryable, error.status)
  return new ProviderError(error.code, sanitizeUserFacingMessage(error.message, error.message), error.retryable, error.status)
}

export function mapDragonCodeHttpError(status: number, payload: unknown): ProviderError {
  const raw = readFlatMessage(payload)
  const flatCode = isRecord(payload) && typeof payload.code === 'string' ? payload.code : undefined
  const wrapped = readWrappedError(payload)
  const type = asString(wrapped?.type)
  if (status === 401 || status === 403 || flatCode === 'API_KEY_REQUIRED' || flatCode === 'INVALID_API_KEY') {
    return new ProviderError('INVALID_KEY', USER_AUTH_FAILURE, false, status || 401)
  }
  if (status === 429) return new ProviderError('RATE_LIMIT', USER_RATE_LIMIT, true, 429)
  if (status === 408 || status === 504) {
    return new ProviderError('TIMEOUT', '图片服务请求超时，请稍后重试', true, 504)
  }
  if (status >= 500) {
    return new ProviderError('UPSTREAM_UNAVAILABLE', '图片服务暂时不可用，请稍后重试', true, 502)
  }
  if (status === 404 || type === 'not_found_error') {
    return new ProviderError('BAD_RESPONSE', USER_NOT_FOUND, false, 404)
  }
  const code: ProviderErrorCode = 'INVALID_PARAMS'
  return new ProviderError(code, friendlyValidationMessage(raw) ?? sanitizeUserFacingMessage(raw, USER_INVALID_REQUEST), false, status >= 400 ? status : 400)
}

export function dragonCodeFailure(message: string, raw?: unknown, options?: { taskFailed?: boolean }) {
  const error = options?.taskFailed ? classifyFailedTask(message) : (() => {
    const text = message || USER_GENERIC_FAILURE
    if (isUpstreamDump(text)) return classifyFailedTask(text)
    const friendly = friendlyValidationMessage(text)
    if (friendly) return new ProviderError('INVALID_PARAMS', friendly, false, 400)
    if (/审核|违规|content.?policy|safety|nsfw|moderat/i.test(text)) {
      return new ProviderError('CONTENT_REJECTED', USER_CONTENT_REJECTED, false, 400)
    }
    return new ProviderError('UNKNOWN', sanitizeUserFacingMessage(text), false, 502)
  })()
  if (raw !== undefined && !process.env.VITEST) {
    console.info(JSON.stringify({
      evt: 'dragoncode',
      stage: 'failure',
      code: error.code,
      message: error.message,
      rawMessage: redactSensitive(message).slice(0, 800),
      payload: sanitizePayload(raw),
    }))
  }
  return error
}

export function missingTaskError() {
  return new ProviderError('BAD_RESPONSE', '图片服务没有返回任务编号', false, 502)
}
