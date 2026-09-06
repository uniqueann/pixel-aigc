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
  backendTaskId?: string
  error?: string
  createdAt: string
  updatedAt: string
}
