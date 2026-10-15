export const MIN_TASK_POLL_DELAY_MS = 1_000
export const MAX_TASK_POLL_DELAY_MS = 30_000

/** 只传相对等待，避免浏览器和服务端时钟偏差影响查询时间。 */
export function imageTaskPollAfterMs(nextPollAt: Date | string | undefined, now: number) {
  const due = nextPollAt == null ? NaN : new Date(nextPollAt).getTime()
  return Number.isFinite(due)
    ? Math.min(MAX_TASK_POLL_DELAY_MS, Math.max(MIN_TASK_POLL_DELAY_MS, Math.ceil(due - now)))
    : undefined
}

/** 只读中心遇到已经到期的推进时间时保留八秒观察，避免后台尚未推进时持续空读。 */
export function taskCenterPollAfterMs(nextPollAt: Date | string | undefined, now: number) {
  if (nextPollAt != null && new Date(nextPollAt).getTime() <= now) return 8_000
  return imageTaskPollAfterMs(nextPollAt, now)
}

/** 多个观察者复用旧快照时，扣除快照在浏览器内已经等待的时间。 */
export function remainingTaskPollMs(pollAfterMs: unknown, elapsedMs = 0) {
  if (typeof pollAfterMs !== 'number' || !Number.isFinite(pollAfterMs) || pollAfterMs < 0) return undefined
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0
  return Math.max(MIN_TASK_POLL_DELAY_MS, Math.min(MAX_TASK_POLL_DELAY_MS, pollAfterMs) - elapsed)
}
