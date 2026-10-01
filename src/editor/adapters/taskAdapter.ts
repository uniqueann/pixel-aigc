import { Capability, type GenerationTask } from '@/types'
import type { Asset, AssetId, GenerationId, GenerationJob } from '@/editor/types'
import { createImageAsset, createVideoAsset } from '@/editor/services/assetService'

export interface TaskAdapterOptions {
  inputAssetIds?: AssetId[]
  parentGenerationId?: GenerationId
  retryOfGenerationId?: GenerationId
  outputSize?: { width: number; height: number }
  existingAssets?: Asset[]
  deferAssets?: boolean
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
  const resultImages = task.resultImages ?? []
  const urls = resultImages.length ? resultImages.map(image => image.url) : (task.resultUrls ?? [])
  const assets = urls.map((url, index) => {
    const measured = resultImages[index]
    const common = {
      id: options.existingAssets?.find(asset => measured?.objectKey && asset.objectKey === measured.objectKey)?.id
        ?? (measured?.ordinal !== undefined ? `asset:${task.id}:o${measured.ordinal}` : assetIdForTaskResult(task.id, index)),
      name: `生成结果 ${index + 1}`,
      url: measured?.url ?? url,
      width: measured?.width || outputSize.width,
      height: measured?.height || outputSize.height,
      mimeType: measured?.mimeType,
      objectKey: measured?.objectKey,
      accessExpiresAt: measured?.expiresAt,
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
      retryOfGenerationId: options.retryOfGenerationId,
      backendTaskId: task.id,
      error: task.errorMessage,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    },
    assets,
  }
}
