import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { App } from 'antd'
import { getTask } from '@/services/api/task'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import { type GenerationTask, type TaskStatus, Capability } from '@/types'
import { taskRefetchIntervalMs } from '@/hooks/taskPollInterval'
import { taskFailureText } from '@/features/generation/providerErrorCopy'
import { emitTaskCenter } from '@/features/task-center/receipts'
import { CloudError } from '@/cloud/client'
const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

/** 旧业务推进保持兼容；缓存隔离且每个观察者独立消费结果。 */
export function useTaskPolling(
  taskId: string | undefined,
  onTask?: (task: GenerationTask<unknown>) => void,
  enabled = true,
) {
  const user = useUserStore((s) => s.userId),
    scope = useUserStore((s) => s.account?.runtimeScope ?? 'local'),
    globalCenter = useUserStore(
      (s) =>
        s.account?.userId === s.userId && !!s.account?.features?.taskCenter,
    )
  const owner = `${user ?? 'local'}:${scope}`,
    previous = useRef<TaskStatus>(),
    callback = useRef(onTask),
    { notification } = App.useApp()
  useEffect(() => {
    callback.current = onTask
  }, [onTask])
  useEffect(() => {
    previous.current = undefined
    useTaskStore.getState().resetOwner(owner)
  }, [taskId, owner])
  const query = useQuery({
    queryKey: ['task', user ?? 'local', scope, taskId],
    queryFn: async ({ signal }) => {
      if (signal.aborted)
        throw signal.reason ?? new DOMException('查询已取消', 'AbortError')
      const value = await getTask(taskId!, { signal })
      if (signal.aborted)
        throw signal.reason ?? new DOMException('查询已取消', 'AbortError')
      const current = useUserStore.getState()
      if (
        current.userId !== user ||
        (current.account?.runtimeScope ?? 'local') !== scope
      )
        throw new CloudError(401, '账号已切换', 'ACCOUNT_CHANGED')
      return value
    },
    enabled: !!taskId && enabled,
    refetchInterval: (q) => taskRefetchIntervalMs(q.state.data, Date.now() - q.state.dataUpdatedAt),
  })
  useEffect(() => {
    const task = query.data,
      current = useUserStore.getState()
    if (
      !task ||
      current.userId !== user ||
      (current.account?.runtimeScope ?? 'local') !== scope
    )
      return
    useTaskStore.getState().upsertTask(task, owner)
    callback.current?.(task)
    const prev = previous.current
    if (globalCenter)
      emitTaskCenter({
        type: 'observed',
        requestId: task.requestId,
        sourceId: task.id,
        sourceKind:
          task.capability === Capability.EmailAssist
            ? 'email_task'
            : 'image_job',
        active: ACTIVE_STATUSES.has(task.status),
      })
    else if (
      prev &&
      prev !== task.status &&
      !ACTIVE_STATUSES.has(task.status)
    ) {
      if (task.status === 'succeeded')
        notification.success({
          message: '任务已完成',
          description: '生成结果已就绪，可在结果区查看',
        })
      else if (task.status === 'failed')
        notification.error({
          message: '任务失败',
          description: taskFailureText(
            task.errorCode,
            task.errorMessage,
            '请重试或更换参数',
          ),
        })
    }
    previous.current = task.status
  }, [
    query.data,
    query.dataUpdatedAt,
    user,
    scope,
    owner,
    globalCenter,
    notification,
  ])
  return query
}
