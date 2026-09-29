import type { ImageEditTaskParams } from '@/types'
import { Capability } from '@/types'
import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'
import { scaleToLongEdge } from './imageEdit'

const TARGET_LONG_EDGE = { '1k': 1024, '2k': 2048, '4k': 4096 } as const

export function buildFusionRequest(context: WorkstationContext): WorkstationGenerationRequest {
  const note = context.prompt?.trim() ?? ''
  const resolution = context.resolution ?? '2k'
  const count = Math.min(4, Math.max(1, Math.round(context.count ?? 1)))
  const product = context.sourceAsset
  const reference = context.referenceAsset
  const outputSize = scaleToLongEdge(product.width, product.height, TARGET_LONG_EDGE[resolution])
  const params: ImageEditTaskParams = {
    sourceImageUrl: product.url,
    referenceImageUrl: reference?.url,
    count,
    resolution,
    size: outputSize,
    sourceWidth: product.width,
    sourceHeight: product.height,
    ...(note ? { prompt: note } : {}),
  }
  return { capability: Capability.ImageEdit, params, outputSize }
}
