import type { ImageEditTaskParams } from '@/types'
import { Capability } from '@/types'
import { normalizeRetouchDirections, retouchOutputSize } from '@shared/retouch'
import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'

export function buildRetouchRequest(context: WorkstationContext): WorkstationGenerationRequest {
  const directions = normalizeRetouchDirections(context.retouchDirections)
  const note = context.prompt?.trim() ?? ''
  const resolution = context.resolution ?? '2k'
  const count = Math.min(4, Math.max(1, Math.round(context.count ?? 1)))
  const outputSize = retouchOutputSize(context.sourceAsset.width, context.sourceAsset.height, resolution)
  const params: ImageEditTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    count,
    resolution,
    size: outputSize,
    sourceWidth: context.sourceAsset.width,
    sourceHeight: context.sourceAsset.height,
    retouchDirections: directions,
    ...(note ? { prompt: note } : {}),
  }
  return { capability: Capability.ImageEdit, params, outputSize }
}
