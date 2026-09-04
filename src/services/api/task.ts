import { apiClient } from './client'
import type { Capability, GenerationTask } from '@/types'

export interface CreateTaskPayload<TParams = Record<string, unknown>> {
  capability: Capability
  params: TParams
  /** 幂等键，前端生成，防止网络重试导致重复扣积分 */
  requestId: string
}

export function createTask<TParams>(payload: CreateTaskPayload<TParams>) {
  return apiClient.post<unknown, GenerationTask>('/tasks', payload)
}

export function getTask(taskId: string) {
  return apiClient.get<unknown, GenerationTask>(`/tasks/${taskId}`)
}

export function listTasks(params?: { capability?: Capability; page?: number }) {
  return apiClient.get<unknown, { items: GenerationTask[]; total: number }>('/tasks', { params })
}

export function cancelTask(taskId: string) {
  return apiClient.post<unknown, void>(`/tasks/${taskId}/cancel`)
}
