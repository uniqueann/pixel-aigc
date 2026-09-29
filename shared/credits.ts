import { readReferenceImageKey } from './fusion.js'
import { readRelight } from './relight.js'
import { readRetouchDirections } from './retouch.js'

export const CREDIT_LEDGER_PAGE_SIZE = 20

export const CREDIT_KIND_LABELS = {
  grant: '赠送/充值',
  reserve: '提交预扣',
  settle: '结算退回',
  refund: '失败/超时退款',
  adjust: '管理员调整',
} as const

export type CreditLedgerKind = keyof typeof CREDIT_KIND_LABELS

export function isCreditLedgerKind(value: string): value is CreditLedgerKind {
  return value in CREDIT_KIND_LABELS
}

export function creditKindLabel(kind: string, delta = 0) {
  if (kind === 'settle' && delta <= 0) return '结算'
  return isCreditLedgerKind(kind) ? CREDIT_KIND_LABELS[kind] : kind
}

export function insufficientCreditsMessage(required: number, balance: number) {
  return `积分余额不足：本次需要 ${required} 积分，当前余额 ${balance}`
}

export function creditToolName(params: unknown, capability?: string) {
  if (readRetouchDirections(params).length) return '精修'
  if (readRelight(params)) return '重新打光'
  if (readReferenceImageKey(params)) return '融合'
  if (capability === 'variation') return '裂变'
  if (capability === 'image_edit') return '智能编辑'
  if (capability === 'fusion') return '融合'
  return ''
}

export function creditJobSpec(resolution?: string, count?: number) {
  const size = resolution?.trim().toUpperCase()
  if (size && count && count > 0) return `${size}×${count}`
  if (size) return size
  if (count && count > 0) return `×${count}`
  return ''
}

export function creditJobTitle(input: {
  params?: unknown
  capability?: string
  resolution?: string
  count?: number
}) {
  const tool = creditToolName(input.params, input.capability)
  const spec = creditJobSpec(input.resolution, input.count)
  return [tool, spec].filter(Boolean).join(' ')
}

export function formatCreditDelta(delta: number) {
  if (delta > 0) return `+${delta}`
  return String(delta)
}
