import type { Capability, TaskStatus } from '@/types'
import type { AssetId, GenerationId } from './ids'

export interface GenerationJob<TInput = unknown> {
  id: GenerationId
  capability: Capability
  status: TaskStatus
  input: TInput
  inputAssetIds: AssetId[]
  outputAssetIds: AssetId[]
  parentGenerationId?: GenerationId
  /** 本次任务是自动或手动重试时，指向前一次失败任务。 */
  retryOfGenerationId?: GenerationId
  backendTaskId?: string
  error?: string
  createdAt: string
  updatedAt: string
}
