import { z } from 'zod'
import { EMAIL_MODELS } from '../shared/email-models.js'
import type { Transaction } from './db.js'
import { HttpError } from './errors.js'
import {
  CREDIT_LEDGER_PAGE_SIZE,
  creditJobTitle,
  creditKindLabel,
  creditToolId,
  formatCreditDelta,
  mergeCreditJobEntries,
  type CreditLedgerItem,
  type CreditLedgerPresentation,
  type CreditLedgerReasonCode,
} from '../shared/credits.js'

const cursorSchema = z.object({
  createdAt: z.string().refine(value => !Number.isNaN(Date.parse(value))),
  id: z.uuid(),
})

export function parseLedgerCursor(value: string | null) {
  if (!value) return undefined
  const [createdAt, id] = value.split('|')
  const parsed = cursorSchema.safeParse({ createdAt, id })
  if (!parsed.success) throw new HttpError(400, '分页参数无效', 'INVALID_CURSOR')
  return parsed.data
}

function readMeta(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function readString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readCount(value: unknown) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

function readResolution(meta: Record<string, unknown>, providerParams: unknown) {
  const fromMeta = readString(meta.resolution)
  if (fromMeta) return fromMeta
  if (!providerParams || typeof providerParams !== 'object' || !('resolution' in providerParams)) return undefined
  return readString((providerParams as { resolution?: unknown }).resolution)
}

function readCountFromRow(meta: Record<string, unknown>, requestedCount: unknown, delta: number) {
  const requested = readCount(requestedCount)
  if (requested) return requested
  const unitPrice = readCount(meta.unitPrice)
  if (unitPrice && delta < 0 && (-delta) % unitPrice === 0) return (-delta) / unitPrice
  return undefined
}

export interface CreditLedgerRow {
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

function rowStatusOf(kind: string): CreditLedgerPresentation['status'] {
  if (kind === 'reserve') return 'reserved'
  if (kind === 'settle') return 'settled'
  if (kind === 'refund') return 'refunded'
  return undefined
}

function ledgerReasonCode(
  row: { kind: string; reason: string | null; idempotency_key?: string | null },
  meta: Record<string, unknown>,
): CreditLedgerReasonCode | undefined {
  const key = row.idempotency_key
  if (key === 'initial') return 'initial_grant'
  if (key?.startsWith('order:') && key.includes(':revoke:')) return 'cash_refund_reclaim'
  if (key?.startsWith('order:')) return 'top_up'
  if (key?.startsWith('admin:')) return 'admin_adjust'
  if (row.reason === '首次赠送') return 'initial_grant'
  if (row.reason === '现金退款或支付争议收回充值积分' || typeof meta.uncollectedCredits === 'number') return 'cash_refund_reclaim'
  if (row.reason === '积分充值' || typeof meta.orderId === 'string') return 'top_up'
  if (row.kind === 'adjust') return 'admin_adjust'
  return undefined
}

export function presentCreditLedgerRow(row: {
  id: string
  kind: string
  delta: number
  balance_after: number
  charged: number | null
  meta: unknown
  reason: string | null
  idempotency_key?: string | null
  created_at: Date | string
  capability: string | null
  params: unknown
  requested_count: number | null
  provider_params: unknown
}): CreditLedgerRow {
  const meta = readMeta(row.meta)
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
  const reasonCode = ledgerReasonCode(row, meta)
  const status = rowStatusOf(row.kind)
  if (meta.free === true) {
    const failed = row.kind === 'refund'
    return {
      id: row.id,
      createdAt,
      kind: row.kind,
      label: '免费抠图',
      title: '免费抠图',
      summary: failed ? '免费额度已退回' : '本月免费额度',
      delta: row.delta,
      deltaText: '免费',
      balanceAfter: row.balance_after,
      charged: typeof row.charged === 'number' ? row.charged : null,
      reason: row.reason,
      presentation: {
        entryType: 'free_bg_remove',
        tool: 'bg-remove',
        status: failed ? 'refunded' : 'settled',
        ...(reasonCode ? { reasonCode } : {}),
      },
    }
  }
  const capability = readString(row.capability) ?? readString(meta.capability)
  const params = row.params ?? (capability === 'text_to_video' && meta.mode === 'video_replication' ? meta : undefined)
  const syncTool = readString(meta.tool)
  const resolution = readResolution(meta, row.provider_params)
  const count = readCountFromRow(meta, row.requested_count, row.delta)
  const durationSeconds = capability === 'text_to_video' && params && typeof params === 'object' && 'durationSeconds' in params && typeof params.durationSeconds === 'number'
    ? params.durationSeconds
    : undefined
  const toolId = capability === 'email_assist'
    ? 'email-assist'
    : syncTool ?? creditToolId(params, capability)
  const title = capability === 'email_assist'
    ? `邮件${({ reply:'回复', summarize:'总结', polish:'润色', grammar:'语法修正' } as Record<string,string>)[String(meta.operation)] ?? '处理'} · ${EMAIL_MODELS.find(model => model.id === meta.modelProfileId)?.label ?? '历史模型'}`
    : syncTool ? ({ erase:'消除',repaint:'重绘',outpaint:'扩图','bg-remove':'商品抠图' }[syncTool] ?? syncTool) : creditJobTitle({
    params,
    capability,
    resolution,
    count,
  })
  const charged = typeof row.charged === 'number' ? row.charged : null
  const label = creditKindLabel(row.kind, row.delta)
  const extra = charged != null && (row.kind === 'settle' || row.kind === 'refund')
    ? `实扣 ${charged}`
    : ''
  const summary = [title, extra].filter(Boolean).join(' ')
  const presentation: CreditLedgerPresentation = capability === 'email_assist'
    ? {
        entryType: 'email_assist',
        tool: 'email-assist',
        capability,
        ...(readString(meta.operation) ? { operation: readString(meta.operation) } : {}),
        ...(readString(meta.modelProfileId) ? { modelProfileId: readString(meta.modelProfileId) } : {}),
        ...(status ? { status } : {}),
        ...(reasonCode ? { reasonCode } : {}),
      }
    : syncTool
      ? {
          entryType: 'sync_tool',
          tool: syncTool,
          ...(capability ? { capability } : {}),
          ...(status ? { status } : {}),
          ...(reasonCode ? { reasonCode } : {}),
        }
      : (capability || toolId)
        ? {
            entryType: 'image_job',
            ...(toolId ? { tool: toolId } : {}),
            ...(capability ? { capability } : {}),
            ...(resolution ? { resolution: resolution.toUpperCase() } : {}),
            ...(count ? { count } : {}),
            ...(typeof durationSeconds === 'number' ? { durationSeconds } : {}),
            ...(status ? { status } : {}),
            ...(reasonCode ? { reasonCode } : {}),
          }
        : {
            entryType: 'account',
            ...(status ? { status } : {}),
            ...(reasonCode ? { reasonCode } : {}),
          }
  return {
    id: row.id,
    createdAt,
    kind: row.kind,
    label,
    title,
    summary,
    delta: row.delta,
    deltaText: formatCreditDelta(row.delta),
    balanceAfter: row.balance_after,
    charged,
    reason: row.reason,
    presentation,
  }
}

function asLedgerSource(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    kind: String(row.kind),
    delta: Number(row.delta),
    balance_after: Number(row.balance_after),
    charged: row.charged == null ? null : Number(row.charged),
    meta: row.meta,
    reason: row.reason == null ? null : String(row.reason),
    idempotency_key: row.idempotency_key == null ? null : String(row.idempotency_key),
    created_at: row.created_at as Date | string,
    capability: row.capability == null ? null : String(row.capability),
    params: row.params,
    requested_count: row.requested_count == null ? null : Number(row.requested_count),
    provider_params: row.provider_params,
    job_id: row.job_id == null ? null : String(row.job_id),
  }
}

function presentLedgerGroup(rows: ReturnType<typeof asLedgerSource>[]): CreditLedgerItem | undefined {
  if (!rows.length) return undefined
  const presented = rows.map(row => presentCreditLedgerRow(row))
  if (rows.some(row => row.job_id)) {
    const merged = mergeCreditJobEntries(presented.map(item => ({
      id: item.id,
      kind: item.kind,
      delta: item.delta,
      balanceAfter: item.balanceAfter,
      charged: item.charged,
      createdAt: item.createdAt,
      title: item.title,
      reason: item.reason,
      presentation: item.presentation,
    })))
    if (rows[0].job_id && readMeta(rows[0].meta).tool) return {...merged,syncRequestId:rows[0].job_id}
    return merged
  }
  return presented[0]
}

export async function listCreditLedger(sql: Transaction, cursor: string | null, limit = CREDIT_LEDGER_PAGE_SIZE) {
  const parsed = parseLedgerCursor(cursor)
  const page = Math.min(50, Math.max(1, limit))
  const groups = parsed
    ? await sql`
        select group_id,newest_at,newest_id from (
          select distinct on (coalesce(job_id, id))
            coalesce(job_id, id) as group_id,
            created_at as newest_at,
            id as newest_id
          from aigc.credit_ledger
          order by coalesce(job_id, id), created_at desc, id desc
        ) grouped_ledger
        where (newest_at, newest_id)<(${parsed.createdAt}::timestamptz,${parsed.id}::uuid)
        order by newest_at desc, newest_id desc
        limit ${page + 1}
      `
    : await sql`
        select group_id,newest_at,newest_id from (
          select distinct on (coalesce(job_id, id))
            coalesce(job_id, id) as group_id,
            created_at as newest_at,
            id as newest_id
          from aigc.credit_ledger
          order by coalesce(job_id, id), created_at desc, id desc
        ) grouped_ledger
        order by newest_at desc, newest_id desc
        limit ${page + 1}
      `
  const hasMore = groups.length > page
  const pageGroups = hasMore ? groups.slice(0, page) : groups
  const groupKeys = pageGroups.map(row => String(row.group_id))
  const rows = groupKeys.length === 0
    ? []
    : await sql`
        select l.id,l.job_id,l.kind,l.delta,l.balance_after,l.charged,l.meta,l.reason,l.idempotency_key,l.created_at,
          j.capability,j.params,j.requested_count,j.provider_params
        from aigc.credit_ledger l
        left join aigc.image_jobs j on j.id=l.job_id
        where coalesce(l.job_id, l.id) in (
          select unnest(string_to_array(${groupKeys.join(',')}, ',')::uuid[])
        )
        order by l.created_at desc, l.id desc
      `
  const grouped = new Map<string, ReturnType<typeof asLedgerSource>[]>()
  for (const row of rows) {
    const source = asLedgerSource(row as Record<string, unknown>)
    const key = source.job_id ?? source.id
    const list = grouped.get(key) ?? []
    list.push(source)
    grouped.set(key, list)
  }
  const items = pageGroups.map(group => {
    const key = String(group.group_id)
    const members = grouped.get(key) ?? []
    return presentLedgerGroup(members)
  }).filter((item): item is CreditLedgerItem => Boolean(item))
  const last = items[items.length - 1]
  const [account] = await sql`select balance from aigc.credit_accounts`
  return {
    balance: account ? Number(account.balance) : 0,
    items,
    nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null,
  }
}
