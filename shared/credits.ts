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
  if (capability === 'text_to_video') return params && typeof params === 'object' && 'mode' in params && params.mode === 'image_to_video' ? '图生视频' : '文生视频'
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
  if (input.capability === 'text_to_video') {
    const duration = input.params && typeof input.params === 'object' && 'durationSeconds' in input.params ? input.params.durationSeconds : undefined
    return [tool, input.resolution?.toUpperCase(), typeof duration === 'number' ? `${duration}秒` : undefined].filter(Boolean).join(' ')
  }
  const spec = creditJobSpec(input.resolution, input.count)
  return [tool, spec].filter(Boolean).join(' ')
}

export function formatCreditDelta(delta: number) {
  if (delta > 0) return `+${delta}`
  return String(delta)
}

export interface CreditLedgerItem {
  id: string
  createdAt: string
  kind: string
  label: string
  title: string
  summary: string
  delta: number
  deltaText: string
  balanceAfter: number
  charged: number | null
  reason: string | null
}

export interface CreditLedgerEntry {
  id: string
  kind: string
  delta: number
  balanceAfter: number
  charged: number | null
  createdAt: string
  title: string
  reason: string | null
}

function sortLedgerNewestFirst(left: CreditLedgerEntry, right: CreditLedgerEntry) {
  if (left.createdAt === right.createdAt) return right.id.localeCompare(left.id)
  return right.createdAt.localeCompare(left.createdAt)
}

export function creditJobGroupStatus(entries: readonly CreditLedgerEntry[]) {
  const reserve = entries.find(item => item.kind === 'reserve')
  const settle = entries.find(item => item.kind === 'settle')
  const refund = entries.find(item => item.kind === 'refund')
  const reserved = reserve ? Math.max(0, -reserve.delta) : 0
  const charged = settle?.charged ?? refund?.charged ?? null
  const refunded = settle ? Math.max(0, settle.delta) : refund ? Math.max(0, refund.delta) : 0
  if (!settle && !refund) {
    return { kind: 'reserve', summary: '处理中 预扣', charged: null as number | null }
  }
  if (refund || charged === 0) {
    return { kind: 'refund', summary: '失败/超时已退款', charged: charged ?? 0 }
  }
  if (refunded > 0 && charged != null && charged > 0) {
    return { kind: 'settle', summary: `实扣 ${charged}, 已退回 ${refunded}`, charged }
  }
  return { kind: 'settle', summary: `实扣 ${charged ?? reserved}`, charged: charged ?? reserved }
}

/** 同一 job 的预扣/结算/退款收成一行；余额取该任务最后一条流水。 */
export function mergeCreditJobEntries(entries: readonly CreditLedgerEntry[]): CreditLedgerItem {
  const ordered = [...entries].sort(sortLedgerNewestFirst)
  const newest = ordered[0]
  const oldest = ordered[ordered.length - 1]
  const title = ordered.map(item => item.title).filter(Boolean).sort((left, right) => right.length - left.length)[0] ?? ''
  const net = ordered.reduce((sum, item) => sum + item.delta, 0)
  const status = creditJobGroupStatus(ordered)
  return {
    id: newest.id,
    createdAt: newest.createdAt,
    kind: status.kind,
    label: title,
    title,
    summary: status.summary,
    delta: net,
    deltaText: formatCreditDelta(net),
    balanceAfter: newest.balanceAfter,
    charged: status.charged,
    reason: oldest.reason,
  }
}
