import { Capability, type TaskStatus } from '@/types'

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

export const VIDEO_POLL_INTERVAL_MS = 5_000
export const IMAGE_POLL_INTERVAL_MS = 2_000
/** 只缩短百炼任务的浏览器间隔。服务端仍按供应商 pollInterval 才去查上游。 */
export const BAILIAN_POLL_INTERVAL_MS = 1_000

export function taskRefetchIntervalMs(task: {
  status?: TaskStatus
  capability?: Capability | string
  modelProfileId?: string
} | undefined): number | false {
  if (!task?.status || !ACTIVE_STATUSES.has(task.status)) return false
  if (task.capability === Capability.TextToVideo) return VIDEO_POLL_INTERVAL_MS
  if (task.modelProfileId?.startsWith('bailian:')) return BAILIAN_POLL_INTERVAL_MS
  return IMAGE_POLL_INTERVAL_MS
}
