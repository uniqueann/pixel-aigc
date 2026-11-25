import { activeLocale } from './format'
import { i18n } from './index'

const CJK_RE = /[\u4e00-\u9fff]/
const PLATFORM_413_RE = /request entity too large|payload too large|request failed with status code 413/i

export const LEGACY_DB_TEXT_TO_KEY = {
  '首次赠送': 'errors:legacyDb.initialGrant',
  '积分充值': 'errors:legacyDb.creditTopUp',
  '现金退款或支付争议收回充值积分': 'errors:legacyDb.cashRefundReclaim',
  '任务处理超时，请重试': 'errors:legacyDb.taskTimeoutRetry',
  '任务处理超时，积分已返还': 'errors:legacyDb.taskTimeoutRefunded',
  '当前排队人数较多，请稍后重试（积分已退回）': 'errors:legacyDb.queueBusyRefunded',
} as const

export function translateLegacyDbText(raw: string | null | undefined, fallback?: string): string | undefined {
  const text = raw?.trim()
  if (!text) return undefined
  const key = LEGACY_DB_TEXT_TO_KEY[text as keyof typeof LEGACY_DB_TEXT_TO_KEY]
  if (key) return i18n.t(key)
  if (activeLocale() === 'zh-CN') return text
  return CJK_RE.test(text) ? fallback : text
}

export function extractErrorExtra(payload: unknown): Record<string, unknown> | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const record = payload as Record<string, unknown>
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key === 'error' || key === 'code' || key === 'requestId') continue
    extra[key] = value
  }
  return Object.keys(extra).length ? extra : undefined
}

export function extractRequestId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return undefined
  const requestId = (payload as Record<string, unknown>).requestId
  return typeof requestId === 'string' && requestId.trim() ? requestId.trim() : undefined
}

export function translateApiError(options: {
  code?: string
  extra?: Record<string, unknown>
  message?: string
  status?: number
  requestId?: string
  fallback?: string
}): string {
  const { code, extra, message, status, requestId, fallback } = options
  const raw = message?.trim() || undefined

  if ((raw && PLATFORM_413_RE.test(raw)) || (!raw && status === 413)) {
    return i18n.t('errors:generic.requestTooLarge')
  }

  // Server responses natively author Chinese messages; preserve exact server phrasing in zh-CN.
  // When no server message exists in zh-CN and the caller gave a contextual fallback, keep the fallback.
  if (activeLocale() === 'zh-CN') {
    if (raw) return raw
    if (fallback) return fallback
  }

  if (code === 'INSUFFICIENT_CREDITS' && typeof extra?.required === 'number' && typeof extra?.balance === 'number') {
    return i18n.t('errors:codes.INSUFFICIENT_CREDITS_DETAIL', {
      required: extra.required,
      balance: extra.balance,
    })
  }

  if (code && i18n.exists(`errors:codes.${code}`)) {
    return i18n.t(`errors:codes.${code}` as never)
  }

  if (raw) {
    const legacy = translateLegacyDbText(raw)
    if (legacy) return legacy
    if (!CJK_RE.test(raw)) return raw
  }

  if (fallback) return fallback
  if (requestId) return i18n.t('errors:generic.requestFailedWithId', { requestId })
  return i18n.t('errors:generic.requestFailed')
}
