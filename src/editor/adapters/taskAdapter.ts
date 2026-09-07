import { Capability, type GenerationTask } from '@/types'
import type { Asset, AssetId, GenerationId, GenerationJob } from '@/editor/types'
import { createImageAsset, createVideoAsset } from '@/editor/services/assetService'

export interface TaskAdapterOptions {
  inputAssetIds?: AssetId[]
  parentGenerationId?: GenerationId
  outputSize?: { width: number; height: number }
  outputDuration?: number
}

export interface AdaptedTask {
  generation: GenerationJob
  assets: Asset[]
}

export function generationIdForTask(taskId: string): GenerationId {
  return `generation:${taskId}`
}

export function assetIdForTaskResult(taskId: string, index: number): AssetId {
  return `asset:${taskId}:${index}`
}

export function adaptGenerationTask<TParams>(
  task: GenerationTask<TParams>,
  options: TaskAdapterOptions = {},
): AdaptedTask {
  const generationId = generationIdForTask(task.id)
  const outputSize = options.outputSize ?? { width: 0, height: 0 }
  const isVideo = task.capability === Capability.TextToVideo
  const assets = (task.resultUrls ?? []).map((url, index) => {
    const common = {
      id: assetIdForTaskResult(task.id, index),
      name: `生成结果 ${index + 1}`,
      url,
      width: outputSize.width,
      height: outputSize.height,
      generationId,
      createdAt: task.updatedAt,
    }
    return isVideo
      ? createVideoAsset({ ...common, duration: options.outputDuration })
      : createImageAsset({ ...common, source: 'generation' })
  })

  return {
    generation: {
      id: generationId,
      capability: task.capability,
      status: task.status,
      input: task.params,
      inputAssetIds: options.inputAssetIds ?? [],
      outputAssetIds: assets.map((asset) => asset.id),
      parentGenerationId: options.parentGenerationId,
      backendTaskId: task.id,
      error: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    assets,
  }
}
