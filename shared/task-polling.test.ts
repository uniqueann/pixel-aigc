import { describe, expect, it } from 'vitest'
import { imageTaskPollAfterMs, remainingTaskPollMs, taskCenterPollAfterMs } from './task-polling.js'

describe('任务读取时间提示', () => {
  it('根据服务端时钟转换成有界相对等待，不依赖浏览器绝对时间', () => {
    const now = Date.parse('2026-10-16T00:00:00Z')
    expect(imageTaskPollAfterMs(new Date(now + 3_000), now)).toBe(3_000)
    expect(imageTaskPollAfterMs(new Date(now - 10_000).toISOString(), now)).toBe(1_000)
    expect(imageTaskPollAfterMs(new Date(now + 120_000), now)).toBe(30_000)
    expect(imageTaskPollAfterMs('无效时间', now)).toBeUndefined()
    expect(imageTaskPollAfterMs(undefined, now)).toBeUndefined()
  })
  it('拒绝非法提示并限制最小间隔，避免旧缓存或异常值导致查询风暴', () => {
    for (const value of [null, undefined, '3000', NaN, Infinity, -1]) expect(remainingTaskPollMs(value)).toBeUndefined()
    expect(remainingTaskPollMs(0)).toBe(1_000)
    expect(remainingTaskPollMs(3_000, -100)).toBe(3_000)
    expect(remainingTaskPollMs(90_000)).toBe(30_000)
    expect(remainingTaskPollMs(3_000, 60_000)).toBe(1_000)
  })
  it('只读快照不能推进后台任务，到期后保留八秒观察而非不断加快读取', () => {
    expect(taskCenterPollAfterMs(new Date(2_000), 1_000)).toBe(1_000)
    expect(taskCenterPollAfterMs(new Date(1_000), 1_001)).toBe(8_000)
    expect(imageTaskPollAfterMs(new Date(1_000), 1_001)).toBe(1_000)
    expect(taskCenterPollAfterMs(undefined, 1_001)).toBeUndefined()
  })
})
