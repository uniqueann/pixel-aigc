import { taskIsActive, type TaskCenterSidebar } from '@shared/task-center'
import { remainingTaskPollMs } from '@shared/task-polling'

/** 任务中心始终只读；隐藏页、离线和错误退避由原运行层控制。 */
export function taskCenterPollIntervalMs(sidebar: TaskCenterSidebar | undefined, watching: boolean, elapsedMs = 0) {
  if (!sidebar?.activeCount && !watching) return 30_000
  const suggestions = (sidebar?.items ?? []).filter(taskIsActive)
    .map(task => remainingTaskPollMs(task.pollAfterMs, elapsedMs))
    .filter((value): value is number => value !== undefined)
  // 未出现在侧栏的任务和旧服务端继续保留原有八秒读取上限。
  return Math.min(8_000, ...suggestions)
}
