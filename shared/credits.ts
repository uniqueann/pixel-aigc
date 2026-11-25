import { readReferenceImageKey } from './fusion.js'
import { readRelight } from './relight.js'
import { readRetouchDirections } from './retouch.js'

export const CREDIT_LEDGER_PAGE_SIZE = 20

export const SYNC_RESULT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export function isSyncResultExpired(
  settledAt: Date | string | number | null | undefined,
  nowMs = Date.now(),
): boolean {
  if (settledAt == null) return true
  const timestamp = typeof settledAt === 'number'
    ? settledAt
    : settledAt instanceof Date
      ? settledAt.getTime()
      : Date.parse(settledAt)
  if (!Number.isFinite(timestamp)) return true
  return nowMs - timestamp >= SYNC_RESULT_RETENTION_MS
}

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

export function creditToolId(params: unknown, capability?: string) {
  if (capability === 'text_to_video') {
    const mode = params && typeof params === 'object' && 'mode' in params ? params.mode : undefined
    if (mode === 'image_to_video') return 'image-to-video'
    if (mode === 'video_replication') return 'video-replication'
    return 'text-to-video'
  }
  if (readRetouchDirections(params).length) return 'retouch'
  if (readRelight(params)) return 'relight'
  if (readReferenceImageKey(params)) return 'fusion'
  if (capability === 'variation') return 'variation'
  if (capability === 'image_edit') return 'smart-edit'
  if (capability === 'fusion') return 'fusion'
  return undefined
}

const CREDIT_TOOL_LABELS: Record<string, string> = {
  'image-to-video': '图生视频',
  'video-replication': '视频复刻',
  'text-to-video': '文生视频',
  retouch: '精修',
  relight: '重新打光',
  fusion: '融合',
  variation: '裂变',
  'smart-edit': '智能编辑',
}

export function creditToolName(params: unknown, capability?: string) {
  const id = creditToolId(params, capability)
  return id ? CREDIT_TOOL_LABELS[id] ?? '' : ''
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

export type CreditLedgerReasonCode =
  | 'initial_grant'
  | 'top_up'
  | 'cash_refund_reclaim'
  | 'admin_adjust'

export interface CreditLedgerPresentation {
  entryType: 'free_bg_remove' | 'email_assist' | 'sync_tool' | 'image_job' | 'account'
  status?: 'reserved' | 'settled' | 'refunded'
  tool?: string
  capability?: string
  operation?: string
  modelProfileId?: string
  resolution?: string
  count?: number
  durationSeconds?: number
  refunded?: number
  reasonCode?: CreditLedgerReasonCode
}

export interface CreditLedgerItem {
  syncRequestId?: string
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
  presentation?: CreditLedgerPresentation
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
  presentation?: CreditLedgerPresentation
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
    return { kind: 'reserve', summary: '处理中 预扣', charged: null as number | null, status: 'reserved' as const, refunded: 0 }
  }
  if (refund || charged === 0) {
    return { kind: 'refund', summary: '失败/超时已退款', charged: charged ?? 0, status: 'refunded' as const, refunded }
  }
  if (refunded > 0 && charged != null && charged > 0) {
    return { kind: 'settle', summary: `实扣 ${charged}, 已退回 ${refunded}`, charged, status: 'settled' as const, refunded }
  }
  return { kind: 'settle', summary: `实扣 ${charged ?? reserved}`, charged: charged ?? reserved, status: 'settled' as const, refunded: 0 }
}

/** 同一 job 的预扣/结算/退款收成一行；余额取该任务最后一条流水。 */
export function mergeCreditJobEntries(entries: readonly CreditLedgerEntry[]): CreditLedgerItem {
  const ordered = [...entries].sort(sortLedgerNewestFirst)
  const newest = ordered[0]
  const oldest = ordered[ordered.length - 1]
  const basePresentation = ordered.find(item =>
    item.presentation?.tool || item.presentation?.capability || item.presentation?.operation || item.presentation?.resolution,
  )?.presentation ?? oldest.presentation ?? newest.presentation
  if (ordered.some(item => item.presentation?.entryType === 'free_bg_remove' || item.title === '免费抠图') && !ordered.some(item => item.kind === 'reserve')) {
    const failed = ordered.some(item => item.kind === 'refund')
    return {
      id: newest.id,
      createdAt: newest.createdAt,
      kind: failed ? 'refund' : 'settle',
      label: '免费抠图',
      title: '免费抠图',
      summary: failed ? '免费额度已退回' : '本月免费额度',
      delta: 0,
      deltaText: '免费',
      balanceAfter: newest.balanceAfter,
      charged: 0,
      reason: oldest.reason,
      presentation: {
        entryType: 'free_bg_remove',
        tool: 'bg-remove',
        status: failed ? 'refunded' : 'settled',
        ...(basePresentation?.reasonCode ? { reasonCode: basePresentation.reasonCode } : {}),
      },
    }
  }
  const title = ordered.map(item => item.title).filter(Boolean).sort((left, right) => right.length - left.length)[0] ?? ''
  const net = ordered.reduce((sum, item) => sum + item.delta, 0)
  const status = creditJobGroupStatus(ordered)
  const presentation: CreditLedgerPresentation | undefined = basePresentation
    ? {
        ...basePresentation,
        status: status.status,
        ...(status.refunded > 0 ? { refunded: status.refunded } : {}),
      }
    : undefined
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
    ...(presentation ? { presentation } : {}),
  }
}
