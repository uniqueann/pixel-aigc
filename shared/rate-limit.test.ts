import { describe, expect, it } from 'vitest'
import {
  hourlyRetryAfterSeconds,
  imageTaskHourlyRateLimitMessage,
  rateLimitWaitMinutes,
  syncHourlyRateLimitMessage,
} from './rate-limit'

describe('限流等待时间', () => {
  it('按窗口内最早一条过期时间算出剩余秒数和分钟', () => {
    const now = Date.parse('2026-09-30T01:00:00.000Z')
    expect(hourlyRetryAfterSeconds('2026-09-30T00:10:00.000Z', now)).toBe(600)
    expect(rateLimitWaitMinutes(600)).toBe(10)
    expect(rateLimitWaitMinutes(1)).toBe(1)
    expect(syncHourlyRateLimitMessage(10)).toBe('该类图片操作已达到每小时使用上限，约 10 分钟后可再试')
    expect(imageTaskHourlyRateLimitMessage(20, 8)).toBe('每小时最多提交 20 次图片任务，约 8 分钟后可再试')
    expect(hourlyRetryAfterSeconds(undefined, now)).toBe(3600)
    expect(hourlyRetryAfterSeconds('not-a-date', now)).toBe(3600)
    expect(hourlyRetryAfterSeconds('2026-09-30T00:00:01.000Z', now)).toBe(1)
  })
})
