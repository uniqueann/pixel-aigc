import { Capability, type TaskStatus } from '@/types'
import { remainingTaskPollMs } from '@shared/task-polling'

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

export const VIDEO_POLL_INTERVAL_MS = 5_000
export const IMAGE_POLL_INTERVAL_MS = 2_000
/** 只缩短百炼任务的浏览器间隔。服务端仍按供应商 pollInterval 才去查上游。 */
export const BAILIAN_POLL_INTERVAL_MS = 1_000

export function taskPollDecision(task: {
  status?: TaskStatus
  capability?: Capability | string
  modelProfileId?: string
  pollAfterMs?: number
} | undefined, elapsedMs = 0) {
  const cachedElapsedMs = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  const pollAfterMs = typeof task?.pollAfterMs === 'number' && remainingTaskPollMs(task.pollAfterMs) !== undefined ? task.pollAfterMs : null
  const base = { pollAfterMs, cachedElapsedMs }
  if (!task?.status || !ACTIVE_STATUSES.has(task.status))
    return { ...base, intervalMs: false as const, source: 'stopped' as const, fallbackReason: null }
  if (task.capability === Capability.TextToVideo)
    return { ...base, intervalMs: VIDEO_POLL_INTERVAL_MS, source: 'video' as const, fallbackReason: null }
  const suggested = remainingTaskPollMs(task.pollAfterMs, elapsedMs)
  if (suggested !== undefined)
    return { ...base, intervalMs: suggested, source: 'server' as const, fallbackReason: null }
  return { ...base,
    intervalMs: task.modelProfileId?.startsWith('bailian:') ? BAILIAN_POLL_INTERVAL_MS : IMAGE_POLL_INTERVAL_MS,
    source: 'fallback' as const,
    fallbackReason: task.pollAfterMs === undefined ? 'missing_hint' as const : 'invalid_hint' as const,
  }
}

export function taskRefetchIntervalMs(...args: Parameters<typeof taskPollDecision>): number | false {
  return taskPollDecision(...args).intervalMs
}
