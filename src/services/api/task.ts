import { cloudEnabled } from '@/cloud/client'
import { apiClient } from './client'
import type { Capability, GenerationTask } from '@/types'
import { cancelMockTask, createMockTask, getMockTask, listMockTasks } from './mockTaskGateway'

export interface CreateTaskPayload<TParams = Record<string, unknown>> {
  capability: Capability
  params: TParams
  /** 幂等键，前端生成，防止网络重试导致重复扣积分 */
  requestId: string
  modelProfileId?: string
}

const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled

export function liveCapabilityReady(capability: Capability, mockGateway = useMockGateway) {
  return mockGateway || capability === 'email_assist'
}

export function createTask<TParams>(payload: CreateTaskPayload<TParams>) {
  if (!liveCapabilityReady(payload.capability))
    return Promise.reject(new Error('该生成能力尚未接入真实服务'))
  if (useMockGateway) return createMockTask(payload)
  return apiClient.post<unknown, GenerationTask<TParams>>('/tasks', payload, { timeout: 55000 })
}

export function getTask(taskId: string) {
  if (useMockGateway) return getMockTask(taskId)
  return apiClient.get<unknown, GenerationTask<unknown>>(`/tasks/${taskId}`)
}

export function listTasks(params?: { capability?: Capability; page?: number }) {
  if (useMockGateway) return listMockTasks().then(result => ({
    items: result.items.map(task => ({ id: task.id, capability: task.capability, status: task.status,
      modelProfileId: task.modelProfileId, operation: (task.params as { operation?: string })?.operation,
      language: (task.params as { language?: string })?.language,
      preview: (task.params as { sourceText?: string })?.sourceText?.slice(0, 80),
      createdAt: task.createdAt, updatedAt: task.updatedAt })), total: result.total,
  }))
  return apiClient.get<unknown, TaskListResponse>('/tasks', { params })
}

export interface TaskSummary {
  id: string
  capability: Capability
  status: GenerationTask['status']
  modelProfileId?: string
  operation?: string
  language?: string
  preview?: string
  createdAt: string
  updatedAt: string
}
export interface TaskListResponse { items: TaskSummary[]; total: number }

export function getTaskByRequest(requestId: string) {
  return apiClient.get<unknown, GenerationTask<unknown>>(`/tasks/by-request/${requestId}`)
}

export function saveTaskEdit(taskId: string, editedText: string) {
  if (useMockGateway) return Promise.resolve(undefined)
  return apiClient.patch<unknown, GenerationTask<unknown>>(`/tasks/${taskId}`, { editedText })
}

export function deleteTask(taskId: string) {
  if (useMockGateway) return cancelMockTask(taskId)
  return apiClient.delete(`/tasks/${taskId}`)
}

export function cancelTask(taskId: string) {
  if (useMockGateway) return cancelMockTask(taskId)
  return apiClient.post<unknown, void>(`/tasks/${taskId}/cancel`)
}
