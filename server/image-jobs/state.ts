export const ACTIVE_JOB_STATUSES = new Set(['queued', 'processing'])
export const TERMINAL_ITEM_STATUSES = new Set(['succeeded', 'failed', 'expired'])
export const POLLABLE_ITEM_STATUSES = new Set(['pending', 'submitted', 'processing'])
export const SALVAGE_WINDOW_MS = 24 * 60 * 60 * 1000
export const LATE_RESULT_WARNING = 'LATE_RESULT_NO_CHARGE'
export const PARTIAL_WARNING = 'PARTIAL'

export interface JobItemSnapshot {
  status: string
  provider_task_id?: string | null
  result_object_key?: string | null
}

export function summarizeItems(items: Array<{ status: string }>) {
  const succeeded = items.filter(item => item.status === 'succeeded').length
  const failed = items.filter(item => item.status === 'failed').length
  const expired = items.filter(item => item.status === 'expired').length
  return {
    succeeded,
    failed,
    expired,
    pending: items.length - succeeded - failed - expired,
    total: items.length,
  }
}

export function mergeWarnings(...groups: Array<string[] | undefined>) {
  return [...new Set(groups.flatMap(group => group ?? []))]
}

export function reduceJobStatus(items: Array<{ status: string }>, now: number, deadlineAt: number) {
  const summary = summarizeItems(items)
  const partial = summary.succeeded > 0 && summary.succeeded < summary.total
  if (summary.pending === 0) {
    if (summary.succeeded === 0) {
      return {
        status: summary.expired === summary.total ? 'expired' as const : 'failed' as const,
        warnings: [] as string[],
      }
    }
    return { status: 'succeeded' as const, warnings: partial ? [PARTIAL_WARNING] : [] }
  }
  if (now >= deadlineAt) {
    if (summary.succeeded > 0) {
      return { status: 'succeeded' as const, warnings: partial ? [PARTIAL_WARNING] : [] }
    }
    return { status: 'expired' as const, warnings: [] as string[] }
  }
  if (items.every(item => item.status === 'pending')) return { status: 'queued' as const, warnings: [] as string[] }
  return { status: 'processing' as const, warnings: [] as string[] }
}

export function toClientTaskStatus(status: string) {
  if (status === 'expired') return { status: 'failed' as const, errorCode: 'TASK_TIMEOUT', errorMessage: '任务处理超时，请重试' }
  return { status, errorCode: undefined as string | undefined, errorMessage: undefined as string | undefined }
}

export function shouldAdvance(job: { status: string; next_poll_at: Date | string; deadline_at: Date | string }, now: number) {
  if (!ACTIVE_JOB_STATUSES.has(job.status) && !canSalvage(job, now)) return false
  return new Date(job.next_poll_at).getTime() <= now
}

export function canSalvage(job: { status: string; deadline_at: Date | string }, now: number, items: JobItemSnapshot[] = []) {
  const deadline = new Date(job.deadline_at).getTime()
  if (now > deadline + SALVAGE_WINDOW_MS) return false
  const hasRecoverable = items.some(item =>
    item.provider_task_id && !item.result_object_key && (item.status === 'submitted' || item.status === 'processing' || item.status === 'expired'))
  if (job.status === 'expired') return hasRecoverable || items.length === 0
  return now >= deadline
}

export function nextPollAt(now: number, intervalMs: number, initial?: boolean, initialDelayMs = 5_000) {
  const delay = initial ? initialDelayMs : Math.max(3_000, intervalMs)
  return new Date(now + delay)
}
