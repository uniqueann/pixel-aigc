import { cloudEnabled } from '@/cloud/client'
import { apiClient } from './client'
import type { Capability, GenerationTask } from '@/types'
import { cancelMockTask, createMockTask, getMockTask, listMockTasks } from './mockTaskGateway'

export interface CreateTaskPayload<TParams = Record<string, unknown>> {
  capability: Capability
  params: TParams
  /** 幂等键，前端生成，防止网络重试导致重复扣积分 */
  requestId: string
}

const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled

export function createTask<TParams>(payload: CreateTaskPayload<TParams>) {
  if (cloudEnabled) return Promise.reject(new Error('真实生成服务尚未接入，当前可使用上传与项目云同步'))
  if (useMockGateway) return createMockTask(payload)
  return apiClient.post<unknown, GenerationTask<TParams>>('/tasks', payload)
}

export function getTask(taskId: string) {
  if (useMockGateway) return getMockTask(taskId)
  return apiClient.get<unknown, GenerationTask<unknown>>(`/tasks/${taskId}`)
}

export function listTasks(params?: { capability?: Capability; page?: number }) {
  if (useMockGateway) return listMockTasks()
  return apiClient.get<unknown, { items: GenerationTask<unknown>[]; total: number }>('/tasks', { params })
}

export function cancelTask(taskId: string) {
  if (useMockGateway) return cancelMockTask(taskId)
  return apiClient.post<unknown, void>(`/tasks/${taskId}/cancel`)
}
