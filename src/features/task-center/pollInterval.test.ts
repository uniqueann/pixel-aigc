import { describe, expect, it } from 'vitest'
import type { TaskCenterSidebar } from '@shared/task-center'
import { taskCenterPollIntervalMs } from './pollInterval'

function sidebar(items: Array<{ state: string; pollAfterMs?: number }>, activeCount = 1) {
  return { items, activeCount } as TaskCenterSidebar
}
describe('任务中心只读刷新节奏', () => {
  it('取进行中任务的最近提示，完成任务不影响刷新时间', () => {
    const data = sidebar([
      { state: 'processing', pollAfterMs: 5_000 }, { state: 'queued', pollAfterMs: 3_000 },
      { state: 'succeeded', pollAfterMs: 1_000 },
    ])
    expect(taskCenterPollIntervalMs(data, false)).toBe(3_000)
    expect(taskCenterPollIntervalMs(data, false, 1_000)).toBe(2_000)
  })
  it('旧服务端和不可见任务保留八秒观察，无活跃任务三十秒', () => {
    expect(taskCenterPollIntervalMs(sidebar([{ state: 'processing' }]), false)).toBe(8_000)
    expect(taskCenterPollIntervalMs(undefined, true)).toBe(8_000)
    expect(taskCenterPollIntervalMs(sidebar([{ state: 'processing', pollAfterMs: 30_000 }]), false)).toBe(8_000)
    expect(taskCenterPollIntervalMs(sidebar([], 0), false)).toBe(30_000)
  })
})
