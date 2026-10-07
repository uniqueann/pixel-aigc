import { mapHttpStatus } from '../http.js'
import { ProviderError } from '../types.js'

const CONTENT_REJECTION = /safety|content.?policy|moderat|违规|审核|unsafe/i
const PROVIDER_TERMS = /terms of service|\bToS\b/i
const FREE_TIER = /free tier|paid credits|upgrade to paid|余额|insufficient/i
const USER_CONTENT_REJECTED = '内容未通过审核'
const USER_PROVIDER_FORBIDDEN = '图片服务暂不可用（上游权限限制）'
const USER_INSUFFICIENT_BALANCE = '图片服务余额不足'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export interface GatewayFailureDetails {
  message: string
  type: string
  metadata?: Record<string, unknown>
}

function textField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

export function readGatewayFailure(payload: unknown): GatewayFailureDetails {
  if (!isRecord(payload)) return { message: '', type: '' }
  const error = payload.error
  const metadata = isRecord(error) && isRecord(error.metadata)
    ? error.metadata
    : isRecord(payload.metadata) ? payload.metadata : undefined
  if (typeof error === 'string') {
    return { message: error.trim(), type: textField(payload.type), ...(metadata ? { metadata } : {}) }
  }
  if (isRecord(error)) {
    const nested = isRecord(error.param) ? error.param : undefined
    const type = textField(error.type) || textField(error.code) || textField(nested?.type) || textField(payload.type)
    const message = textField(error.message) || textField(nested?.message) || textField(payload.message)
    return { message, type, ...(metadata ? { metadata } : {}) }
  }
  return { message: textField(payload.message), type: textField(payload.type), ...(metadata ? { metadata } : {}) }
}

export function redactGatewayText(value: string, secrets: Array<string | undefined> = []) {
  let text = value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[redacted]')
  for (const secret of secrets) {
    const trimmed = secret?.trim()
    if (trimmed && trimmed.length >= 8 && text.includes(trimmed)) text = text.split(trimmed).join('[redacted]')
  }
  return text
}

export function clipGatewayLog(value: string, secrets: Array<string | undefined> = []) {
  return redactGatewayText(value, secrets).slice(0, 200)
}

function reasonText(item: unknown) {
  if (typeof item === 'string') return item
  if (item == null) return ''
  try {
    const text = JSON.stringify(item)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

function hasFlaggedInput(metadata: Record<string, unknown>) {
  if (!('flagged_input' in metadata)) return false
  const flagged = metadata.flagged_input
  if (typeof flagged === 'string') return flagged.trim().length > 0
  if (Array.isArray(flagged)) return flagged.length > 0
  return flagged != null && flagged !== false
}

function hasReasons(metadata: Record<string, unknown>) {
  const reasons = metadata.reasons
  if (typeof reasons === 'string') return reasons.trim().length > 0
  if (!Array.isArray(reasons)) return false
  return reasons.some(item => reasonText(item).trim().length > 0)
}

function forbidden(status = 403) {
  return new ProviderError('PROVIDER_FORBIDDEN', USER_PROVIDER_FORBIDDEN, false, status)
}

function balance(status = 402) {
  return new ProviderError('INSUFFICIENT_BALANCE', USER_INSUFFICIENT_BALANCE, false, status)
}

/**
 * 402 是余额。403 的 ToS / customer_verification_required 是权限。
 * no_providers_available 的免费层文案归余额，其余（例如团队 allowlist）归权限。
 * 审核只认明确的 moderation / safety，或 metadata.reasons / flagged_input。
 */
export function classifyAiGatewayFailure(status: number, payload: unknown): ProviderError {
  const details = readGatewayFailure(payload)
  const type = details.type.toLowerCase()
  const message = details.message
  if (type === 'customer_verification_required' || /customer_verification_required/i.test(message)) {
    return forbidden(status === 402 ? 402 : 403)
  }
  if (type === 'no_providers_available' || /no_providers_available/i.test(message)) {
    return FREE_TIER.test(message) ? balance() : forbidden()
  }
  if (status === 403 && PROVIDER_TERMS.test(message)) return forbidden()
  if (CONTENT_REJECTION.test(message) || (details.metadata && (hasFlaggedInput(details.metadata) || hasReasons(details.metadata)))) {
    return new ProviderError('CONTENT_REJECTED', USER_CONTENT_REJECTED, false, 400)
  }
  // Gateway 的 401 才是密钥问题。其余 403 按权限限制，避免误报成密钥无效。
  if (status === 403) return forbidden()
  if (status === 402) return balance()
  return mapHttpStatus(status, '')
}
