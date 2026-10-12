import { cloudRequest, CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import type {
  TaskCenterDetail,
  TaskCenterHistory,
  TaskCenterSidebar,
  TaskCenterSummary,
  TaskHistoryState,
  TaskScope,
  TaskSourceKind,
  TaskTool,
} from '@shared/task-center'

export interface TaskActor {
  owner: string
  scope: TaskScope
}
export function currentTaskActor(): TaskActor | null {
  const { account, userId } = useUserStore.getState()
  return account?.userId === userId && account?.runtimeScope
    ? { owner: account.userId, scope: account.runtimeScope }
    : null
}
export function sameTaskActor(actor: TaskActor) {
  const current = currentTaskActor()
  return current?.owner === actor.owner && current.scope === actor.scope
}
export function taskCenterOn() {
  return (
    !!currentTaskActor() &&
    !!useUserStore.getState().account?.features?.taskCenter
  )
}
async function read<T>(
  actor: TaskActor,
  path: string,
  signal?: AbortSignal,
  method = 'GET',
  body?: unknown,
) {
  if (!sameTaskActor(actor))
    throw new CloudError(401, '账号或环境已切换', 'ACCOUNT_CHANGED')
  const data = await cloudRequest<T>(path, method, body, {
    expectedUserId: actor.owner,
    signal,
    timeoutMs: 15000,
  })
  if (!sameTaskActor(actor))
    throw new CloudError(401, '账号或环境已切换', 'ACCOUNT_CHANGED')
  return data
}
export const taskCenterKeys = {
  root: (actor: TaskActor) =>
    ['task-center', actor.owner, actor.scope] as const,
  sidebar: (actor: TaskActor) =>
    [...taskCenterKeys.root(actor), 'sidebar'] as const,
  detail: (actor: TaskActor, key: string) =>
    [...taskCenterKeys.root(actor), 'detail', key] as const,
  summary:(actor:TaskActor,kind:TaskSourceKind,requestId:string)=>[...taskCenterKeys.root(actor),'summary',kind,requestId] as const,
}
export function readTaskSidebar(actor: TaskActor, signal?: AbortSignal) {
  return read<TaskCenterSidebar>(actor, '/task-center?view=sidebar', signal)
}
export function readTaskHistory(
  actor: TaskActor,
  filters: { tool?: TaskTool; state: TaskHistoryState },
  cursor?: string,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({ view: 'history', state: filters.state })
  if (filters.tool) query.set('tool', filters.tool)
  if (cursor) query.set('cursor', cursor)
  return read<TaskCenterHistory>(actor, `/task-center?${query}`, signal)
}
export function readTaskSummary(
  actor: TaskActor,
  kind: TaskSourceKind,
  requestId: string,
  signal?: AbortSignal,
) {
  return read<TaskCenterSummary>(
    actor,
    `/task-center/by-request/${kind}/${encodeURIComponent(requestId)}`,
    signal,
  )
}
export function readTaskDetail(
  actor: TaskActor,
  kind: TaskSourceKind,
  id: string,
  signal?: AbortSignal,
) {
  return read<TaskCenterDetail>(
    actor,
    `/task-center/${kind}/${encodeURIComponent(id)}`,
    signal,
  )
}
export function recordPresentation(
  actor: TaskActor,
  task: TaskCenterSummary,
  action: 'seen' | 'dismiss',
) {
  return read<TaskCenterSummary>(
    actor,
    `/task-center/${task.sourceKind}/${task.sourceId}/presentation`,
    undefined,
    'PATCH',
    { action, outcomeVersion: task.outcomeVersion },
  )
}
