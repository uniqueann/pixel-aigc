import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { App } from 'antd'
import { getTask } from '@/services/api/task'
import { useTaskStore } from '@/store/useTaskStore'
import type { GenerationTask, TaskStatus } from '@/types'

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

/**
 * 轮询单个任务状态，任务进入终态（succeeded/failed/cancelled）后自动停止轮询，
 * 并在状态从"进行中"变为终态时弹一次全局通知。
 * 生产环境建议优先用 WebSocket/SSE 推送，这里先用轮询兜底，接口不用改。
 */
export function useTaskPolling(taskId: string | undefined, onTask?: (task: GenerationTask<unknown>) => void, enabled = true) {
  const upsertTask = useTaskStore((s) => s.upsertTask)
  const { notification } = App.useApp()
  const prevStatusRef = useRef<TaskStatus>()

  useEffect(() => {
    prevStatusRef.current = undefined
  }, [taskId])

  return useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const task = await getTask(taskId!)
      upsertTask(task)
      onTask?.(task)

      const prev = prevStatusRef.current
      if (prev && prev !== task.status && !ACTIVE_STATUSES.has(task.status)) {
        if (task.status === 'succeeded') {
          notification.success({ message: '任务已完成', description: '生成结果已就绪，可在结果区查看' })
        } else if (task.status === 'failed') {
          notification.error({ message: '任务失败', description: task.errorMessage || '请重试或更换参数' })
        }
      }
      prevStatusRef.current = task.status

      return task
    },
    enabled: !!taskId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status && ACTIVE_STATUSES.has(status) ? 2000 : false
    },
  })
}
