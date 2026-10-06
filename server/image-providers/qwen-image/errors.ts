import { dashScopeFailureText } from '../../dashscope.js'
import { describeError } from '../../errors.js'
import { ProviderError } from '../types.js'

const PRE_SEND_CODES = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'EHOSTUNREACH',
])

function errorChain(error: unknown) {
  const chain: Error[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current instanceof Error; depth += 1) {
    chain.push(current)
    current = current.cause
  }
  return chain
}

/**
 * 连接还没建立、请求字节还没写出。ECONNRESET / 裸 fetch failed / 读超时都不算：
 * 那些情况下上游可能已经收到提交，不能再发一单。
 */
export function isPreSendConnectError(error: unknown) {
  return errorChain(error).some(item => {
    const code = 'code' in item && typeof item.code === 'string' ? item.code : ''
    return PRE_SEND_CODES.has(code) || item.name === 'ConnectTimeoutError'
  })
}

export function connectErrorLogFields(error: unknown) {
  const chain = errorChain(error)
  const codes = chain.flatMap(item => {
    const code = 'code' in item && typeof item.code === 'string' ? item.code : ''
    return code ? [code] : []
  })
  const described = describeError(error)
  return {
    error: described.message,
    errorName: described.name,
    ...(codes.length ? { errorCode: codes.join(',') } : {}),
    ...(described.cause ? { cause: described.cause } : {}),
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function asFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function isContentRejection(code: string, message: string) {
  return code === 'DataInspectionFailed'
    || code === 'InvalidParameter.DataInspection'
    || code === 'InvalidParameter.ImageContent'
    || /审核|违规|content.?moderat|safety|nsfw/i.test(`${code} ${message}`)
}

export function mapQwenFailure(status: number, code: string, message: string) {
  const text = dashScopeFailureText(code, message, '文生图')
  if (isContentRejection(code, message)) {
    return new ProviderError('CONTENT_REJECTED', '内容未通过审核', false, 400)
  }
  if (code === 'IPInfringementSuspect') {
    return new ProviderError('CONTENT_REJECTED', '内容可能涉及侵权，无法生成', false, 400)
  }
  if (code === 'InvalidApiKey' || /invalid api-?key|no api-key/i.test(`${code} ${message}`) || status === 401 || status === 403) {
    return new ProviderError('INVALID_KEY', code ? text : '阿里云百炼 API Key 无效', false, status === 403 ? 403 : 401)
  }
  if (code === 'Arrearage' || /欠费|arrearage/i.test(`${code} ${message}`)) {
    return new ProviderError('INSUFFICIENT_BALANCE', text, false, 402)
  }
  if (status === 429 || /^Throttling/i.test(code) || /rate.?limit|too many requests/i.test(message)) {
    return new ProviderError('RATE_LIMIT', '图片服务请求过于频繁，请稍后重试', true, 429)
  }
  if (status === 408 || status === 504) {
    return new ProviderError('TIMEOUT', '图片服务请求超时，请稍后重试', true, 504)
  }
  if (code.startsWith('InternalError') || status >= 500) {
    return new ProviderError('UPSTREAM_UNAVAILABLE', text, status >= 500, 502)
  }
  if (code.startsWith('InvalidParameter') || code === 'InvalidParameter' || status === 400) {
    return new ProviderError('INVALID_PARAMS', text, false, 400)
  }
  return new ProviderError('UNKNOWN', text || '文生图失败', false, status >= 400 ? status : 502)
}

export function readRequestCode(payload: unknown) {
  if (!isRecord(payload)) return { code: '', message: '' }
  const output = isRecord(payload.output) ? payload.output : undefined
  return {
    code: asString(payload.code) ?? asString(output?.code) ?? '',
    message: asString(payload.message) ?? asString(output?.message) ?? '',
  }
}
