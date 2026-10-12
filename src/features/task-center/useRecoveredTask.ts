import { useEffect,useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { taskIsActive, type TaskTool } from '@shared/task-center'
import { readTaskDetail, readTaskSummary, recordPresentation, sameTaskActor, taskCenterKeys } from './client'
import { emitTaskCenter } from './receipts'
import { useTaskCenter } from './context'
import { parseTaskRoute, taskMatchesTool } from './route'

export function useRecoveredTask(tools: readonly TaskTool[], projectId?: string,markSeen = true) {
  const [params, setParams] = useSearchParams()
  const account=useUserStore(state => state.account),userId=useUserStore(state=>state.userId)
  const owner=account?.userId===userId?account?.userId:undefined,scope=account?.runtimeScope
  const actor = useMemo(()=>owner&&scope?{owner,scope}:null,[owner,scope]), raw = params.get('task'), identity = parseTaskRoute(raw)
  const enabled = !!actor && !!identity && !!useUserStore.getState().account?.features?.taskCenter
  const center = useTaskCenter()
  const coordinated = !!actor && center?.actor.owner === actor.owner && center.actor.scope === actor.scope
  const detail = useQuery({ queryKey: actor ? taskCenterKeys.detail(actor, identity?.taskKey ?? 'none') : ['task-center-unready'],
    enabled, retry: false, staleTime: 30000,
    queryFn: async ({ signal }) => {
      const value = await readTaskDetail(actor!, identity!.sourceKind, identity!.sourceId, signal)
      if(value.task.taskKey!==identity!.taskKey)throw new CloudError(400,'任务身份与请求不匹配','TASK_ROUTE_MISMATCH')
      if (!taskMatchesTool(value.task, tools, projectId)) throw new CloudError(400,'此任务不属于当前工具或项目','TASK_ROUTE_MISMATCH')
      return value
    } })
  // 摘要有变化才重新读取结果地址，持续观察不反复签名或检查对象。
  const summary = useQuery({ queryKey: actor && detail.data ? taskCenterKeys.summary(actor, detail.data.task.sourceKind, detail.data.task.requestId) : ['task-center-summary-unready'],
    enabled: enabled && !!detail.data && !coordinated, retry: false,
    initialData: detail.data?.task,
    queryFn: ({ signal }) => readTaskSummary(actor!, identity!.sourceKind, detail.data!.task.requestId, signal),
    refetchInterval: query => !coordinated && detail.data ? (taskIsActive(query.state.data ?? detail.data.task) ? 8000 : 30000) : false,
    refetchIntervalInBackground: false })
  const task = detail.data?.task
  const valid = !!task && taskMatchesTool(task, tools, projectId) && !!actor && sameTaskActor(actor)
  useEffect(() => {
    if (!enabled || !valid || !task || !actor) return
    const newer = summary.data
    if (newer && newer.taskKey===task.taskKey && Date.parse(newer.updatedAt)>=Date.parse(task.updatedAt) && (newer.state !== task.state || newer.outcomeVersion !== task.outcomeVersion || newer.completedCount !== task.completedCount || newer.billingState !== task.billingState)) void detail.refetch()
    // 同一身份的数据观察不会改变工具输入。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled,valid,task,summary.data])
  useEffect(() => {
    if (!enabled || !valid || !task || !actor || !coordinated) return
    const event = { type:'observed' as const, sourceKind:task.sourceKind, sourceId:task.sourceId, requestId:task.requestId, actor }
    emitTaskCenter({ ...event, active:taskIsActive(task), viewing:true })
    return () => emitTaskCenter({ ...event, viewing:false })
    // 工具结果区只订阅共享摘要；全局运行层统一读取侧栏之外的当前任务。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled,valid,coordinated,task?.taskKey,task?.requestId,actor?.owner,actor?.scope])
  useEffect(() => {
    if (!enabled || !valid || !actor || !detail.data) return
    const times = detail.data.results.flatMap(result => result.kind !== 'text' && result.availability === 'available' ? [Date.parse(result.urlExpiresAt)] : []).filter(Number.isFinite)
    if (!times.length) return
    const timer = setTimeout(() => { if (sameTaskActor(actor)) void detail.refetch() }, Math.max(1000,Math.min(...times)-Date.now()))
    return () => clearTimeout(timer)
    // 地址到期仅更新当前详情。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled,valid,detail.data,actor?.owner,actor?.scope])
  useEffect(() => {
    if (!markSeen || !enabled || !valid || !actor || !task?.outcomeVersion || task.seen) return
    let active = true
    void recordPresentation(actor,task,'seen').then(() => { if (active && sameTaskActor(actor)) emitTaskCenter({ type:'refresh' }) }).catch(error => {
      if (active && sameTaskActor(actor) && error instanceof CloudError && error.status === 409) void detail.refetch()
    })
    return () => { active = false }
    // 按终态版本标记，签名更新不重新查看。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [markSeen,enabled,valid,task?.taskKey,task?.outcomeVersion])
  return { actor, identity, present: raw !== null, invalid: raw !== null && !identity,
    enabled, data: enabled && valid ? detail.data : undefined, loading: enabled && detail.isPending,
    error: detail.error ?? summary.error, refresh: () => { if(enabled)void detail.refetch(); if(enabled&&coordinated)center?.refresh(); else if(enabled&&detail.data)void summary.refetch() },
    close: () => { const next = new URLSearchParams(params); next.delete('task'); next.delete('sceneId'); setParams(next,{replace:true}) } }
}
