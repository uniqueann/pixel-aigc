import { authEnabled, cloudEnabled, cloudRequest } from '@/cloud/client'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import { apiClient } from './client'
import { Capability, type GenerationTask } from '@/types'
import { cancelMockTask, createMockTask, getMockTask, listMockTasks } from './mockTaskGateway'

export interface CreateTaskPayload<TParams = Record<string, unknown>> {
  capability: Capability
  params: TParams
  /** 幂等键，前端生成，防止网络重试导致重复扣积分 */
  requestId: string
  modelProfileId?: string
}

const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled

/** 静态已接入集合。智能编辑等能力还会与 GET /api/capabilities 的动态开关求并。 */
const LIVE_TASK_CAPABILITIES = new Set<Capability>([Capability.EmailAssist])

/**
 * 工作站已接通、服务端 /tasks 会转到 image_jobs 的能力。
 * 不写入 LIVE_TASK_CAPABILITIES，自由画布裂变入口仍由 availability 开关单独禁用。
 */
const WORKSTATION_TASK_CAPABILITIES = new Set<Capability>([Capability.Variation])
const BILLED_TASK_CAPABILITIES = new Set<Capability>([Capability.ImageEdit, Capability.Variation])
let creditRefreshSequence = 0

async function refreshCredits() {
  if (!authEnabled) return
  const sequence = ++creditRefreshSequence
  const account = await cloudRequest<AccountContext>('/me')
  if (sequence === creditRefreshSequence && useUserStore.getState().account?.userId === account.userId)
    useUserStore.getState().setAccount(account)
}

export function registerLiveCapability(capability: Capability, ready: boolean) {
  if (capability === Capability.EmailAssist) return
  if (ready) LIVE_TASK_CAPABILITIES.add(capability)
  else LIVE_TASK_CAPABILITIES.delete(capability)
}

export function liveCapabilityReady(capability: Capability, mockGateway = useMockGateway) {
  return mockGateway || LIVE_TASK_CAPABILITIES.has(capability)
}

export function canCreateLiveTask(capability: Capability, mockGateway = useMockGateway) {
  return liveCapabilityReady(capability, mockGateway) || WORKSTATION_TASK_CAPABILITIES.has(capability)
}

export function createTask<TParams>(payload: CreateTaskPayload<TParams>) {
  if (!canCreateLiveTask(payload.capability))
    return Promise.reject(new Error('该生成能力尚未接入真实服务'))
  if (useMockGateway) return createMockTask(payload)
  return apiClient.post<unknown, GenerationTask<TParams>>('/tasks', payload, { timeout: 55000 })
    .then(task => {
      if (BILLED_TASK_CAPABILITIES.has(payload.capability)) void refreshCredits().catch(() => undefined)
      return task
    })
}

export function getTask(taskId: string) {
  if (useMockGateway) return getMockTask(taskId)
  return apiClient.get<unknown, GenerationTask<unknown>>(`/tasks/${taskId}`).then(task => {
    if (BILLED_TASK_CAPABILITIES.has(task.capability) &&
      (task.status === 'succeeded' || task.status === 'failed' || task.status === 'cancelled'))
      void refreshCredits().catch(() => undefined)
    return task
  })
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
    .then(task => {
      if (BILLED_TASK_CAPABILITIES.has(task.capability)) void refreshCredits().catch(() => undefined)
      return task
    })
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
