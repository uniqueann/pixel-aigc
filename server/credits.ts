import { z } from 'zod'
import type { Transaction } from './db.js'
import { HttpError } from './errors.js'
import {
  CREDIT_LEDGER_PAGE_SIZE,
  creditJobTitle,
  creditKindLabel,
  formatCreditDelta,
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
}

export function presentCreditLedgerRow(row: {
  id: string
  kind: string
  delta: number
  balance_after: number
  charged: number | null
  meta: unknown
  reason: string | null
  created_at: Date | string
  capability: string | null
  params: unknown
  requested_count: number | null
  provider_params: unknown
}): CreditLedgerRow {
  const meta = readMeta(row.meta)
  const capability = readString(row.capability) ?? readString(meta.capability)
  const title = creditJobTitle({
    params: row.params,
    capability,
    resolution: readResolution(meta, row.provider_params),
    count: readCountFromRow(meta, row.requested_count, row.delta),
  })
  const charged = typeof row.charged === 'number' ? row.charged : null
  const label = creditKindLabel(row.kind, row.delta)
  const extra = charged != null && (row.kind === 'settle' || row.kind === 'refund')
    ? `实扣 ${charged}`
    : ''
  const summary = [title, extra].filter(Boolean).join(' ')
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at)
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
  }
}

export async function listCreditLedger(sql: Transaction, cursor: string | null, limit = CREDIT_LEDGER_PAGE_SIZE) {
  const parsed = parseLedgerCursor(cursor)
  const page = Math.min(50, Math.max(1, limit))
  const rows = parsed
    ? await sql`
        select l.id,l.kind,l.delta,l.balance_after,l.charged,l.meta,l.reason,l.created_at,
          j.capability,j.params,j.requested_count,j.provider_params
        from aigc.credit_ledger l
        left join aigc.image_jobs j on j.id=l.job_id
        where (l.created_at,l.id)<(${parsed.createdAt}::timestamptz,${parsed.id}::uuid)
        order by l.created_at desc,l.id desc
        limit ${page + 1}
      `
    : await sql`
        select l.id,l.kind,l.delta,l.balance_after,l.charged,l.meta,l.reason,l.created_at,
          j.capability,j.params,j.requested_count,j.provider_params
        from aigc.credit_ledger l
        left join aigc.image_jobs j on j.id=l.job_id
        order by l.created_at desc,l.id desc
        limit ${page + 1}
      `
  const hasMore = rows.length > page
  const pageRows = hasMore ? rows.slice(0, page) : rows
  const items = pageRows.map(row => presentCreditLedgerRow({
    id: String(row.id),
    kind: String(row.kind),
    delta: Number(row.delta),
    balance_after: Number(row.balance_after),
    charged: row.charged == null ? null : Number(row.charged),
    meta: row.meta,
    reason: row.reason == null ? null : String(row.reason),
    created_at: row.created_at as Date | string,
    capability: row.capability == null ? null : String(row.capability),
    params: row.params,
    requested_count: row.requested_count == null ? null : Number(row.requested_count),
    provider_params: row.provider_params,
  }))
  const last = items[items.length - 1]
  const [account] = await sql`select balance from aigc.credit_accounts`
  return {
    balance: account ? Number(account.balance) : 0,
    items,
    nextCursor: hasMore && last ? `${last.createdAt}|${last.id}` : null,
  }
}
