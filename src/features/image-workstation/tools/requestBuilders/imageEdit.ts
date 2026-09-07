import type { ImageEditTaskParams } from '@/types'
import { Capability } from '@/types'
import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'

const TARGET_LONG_EDGE = { '2k': 2048, '4k': 4096 } as const

export function buildImageEditRequest(context: WorkstationContext): WorkstationGenerationRequest {
  const prompt = context.prompt?.trim() ?? ''
  const resolution = context.resolution ?? '2k'
  const count = Math.min(4, Math.max(1, Math.round(context.count ?? 1)))
  const outputSize = scaleToLongEdge(
    context.sourceAsset.width,
    context.sourceAsset.height,
    TARGET_LONG_EDGE[resolution],
  )
  const params: ImageEditTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    prompt,
    count,
    resolution,
    size: outputSize,
  }

  return { capability: Capability.ImageEdit, params, outputSize }
}

export function scaleToLongEdge(width: number, height: number, longEdge: number) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const scale = longEdge / Math.max(safeWidth, safeHeight)
  return {
    width: Math.round(safeWidth * scale),
    height: Math.round(safeHeight * scale),
  }
}
