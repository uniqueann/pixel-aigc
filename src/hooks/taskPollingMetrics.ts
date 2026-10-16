import type { taskPollDecision } from './taskPollInterval'

type Decision = ReturnType<typeof taskPollDecision>
type Schedule = Decision & { intervalMs: number; scheduledAt: number; dataUpdatedAt: number }
const observations = new WeakMap<object, {
  startedAt?: number
  schedules: Map<object, Schedule>
}>()

/** 同间隔、同快照的重算不会重设定时器；每个观察者保留自己的有效计划。 */
export function rememberTaskPollSchedule(query: object, observer: object, decision: Decision, dataUpdatedAt: number, now = Date.now()) {
  const observation = observations.get(query) ?? { schedules: new Map<object, Schedule>() }
  const previous = observation.schedules.get(observer)
  if (decision.intervalMs === false) observation.schedules.delete(observer)
  else if (!previous || previous.intervalMs !== decision.intervalMs || previous.dataUpdatedAt !== dataUpdatedAt)
    observation.schedules.set(observer, { ...decision, intervalMs: decision.intervalMs, scheduledAt: now, dataUpdatedAt })
  observations.set(query, observation)
}

export function forgetTaskPollSchedule(query: object, observer: object) {
  observations.get(query)?.schedules.delete(observer)
}

/** 在共享查询真正发出时记录最早到期的有效计划；聚焦或手动刷新可能提前触发。 */
export function observeTaskPollRequest(query: object, taskId: string, scope: string, now = Date.now()) {
  const observation = observations.get(query) ?? { schedules: new Map<object, Schedule>() }
  const schedule = [...observation.schedules.values()].sort((a, b) => a.scheduledAt + a.intervalMs - b.scheduledAt - b.intervalMs)[0]
  const actualIntervalMs = observation.startedAt === undefined ? null : Math.max(0, now - observation.startedAt)
  observation.startedAt = now
  observation.schedules.clear()
  observations.set(query, observation)
  try {
    console.info({
      evt: 'task-poll-request', taskId, scope,
      source: schedule?.source ?? 'unscheduled',
      pollAfterMs: schedule?.pollAfterMs ?? null,
      intervalMs: schedule?.intervalMs ?? null,
      cachedElapsedMs: schedule?.cachedElapsedMs ?? null,
      fallbackReason: schedule?.fallbackReason ?? null,
      actualWaitMs: schedule ? Math.max(0, now - schedule.scheduledAt) : null,
      actualIntervalMs,
    })
  } catch { /* 日志不可影响查询、取消或账号隔离。 */ }
}
