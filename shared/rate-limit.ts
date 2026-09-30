export const USER_CONCURRENCY_RETRY_AFTER = 5

export function hourlyRetryAfterSeconds(oldestCreatedAt?: Date | string | null, now = Date.now()) {
  if (!oldestCreatedAt) return 3600
  const oldest = typeof oldestCreatedAt === 'string' ? Date.parse(oldestCreatedAt) : oldestCreatedAt.getTime()
  if (Number.isNaN(oldest)) return 3600
  return Math.max(1, Math.ceil((oldest + 3_600_000 - now) / 1000))
}

export function rateLimitWaitMinutes(seconds: number) {
  return Math.max(1, Math.ceil(seconds / 60))
}

export function syncHourlyRateLimitMessage(minutes: number) {
  return `该类图片操作已达到每小时使用上限，约 ${minutes} 分钟后可再试`
}

export function imageTaskHourlyRateLimitMessage(limit: number, minutes: number) {
  return `每小时最多提交 ${limit} 次图片任务，约 ${minutes} 分钟后可再试`
}

export const SYNC_USER_CONCURRENCY_MESSAGE = '该类图片操作正在处理中，请等待当前任务完成'
export const IMAGE_TASK_USER_CONCURRENCY_MESSAGE = '当前已有图片任务正在处理，请等待当前任务完成'

export function rateLimitExtra(seconds: number) {
  return { retryAfterSeconds: seconds }
}
