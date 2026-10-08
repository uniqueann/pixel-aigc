import type { ImageEditTaskParams } from '@/types'
import { Capability } from '@/types'
import { PROMPT_MAX_LENGTH } from '@shared/prompt-limits'
import { RELIGHT_DEFAULT, fitRelightNote, type RelightOptions } from '@shared/relight'
import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'
import { scaleToLongEdge } from './imageEdit'

const TARGET_LONG_EDGE = { '1k': 1024, '2k': 2048, '4k': 4096 } as const

export function buildRelightRequest(context: WorkstationContext): WorkstationGenerationRequest {
  const note = fitRelightNote(context.prompt, context.promptMaxLength ?? PROMPT_MAX_LENGTH)
  const resolution = context.resolution ?? '2k'
  const count = Math.min(4, Math.max(1, Math.round(context.count ?? 2)))
  const relight: RelightOptions = context.relight ?? RELIGHT_DEFAULT
  const outputSize = scaleToLongEdge(
    context.sourceAsset.width,
    context.sourceAsset.height,
    TARGET_LONG_EDGE[resolution],
  )
  const params: ImageEditTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    count,
    resolution,
    size: outputSize,
    sourceWidth: context.sourceAsset.width,
    sourceHeight: context.sourceAsset.height,
    relight,
    ...(note ? { prompt: note } : {}),
  }
  return { capability: Capability.ImageEdit, params, outputSize }
}
