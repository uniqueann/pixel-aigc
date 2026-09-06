import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'
import { Capability, type OutpaintTaskParams } from '@/types'

export function buildOutpaintRequest(context: WorkstationContext): WorkstationGenerationRequest {
  if (!context.maskUrl || !context.targetSize || !context.originOffset) {
    throw new Error('扩图画布尚未准备好')
  }
  const params: OutpaintTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    maskUrl: context.maskUrl,
    targetSize: context.targetSize,
    originOffset: context.originOffset,
  }
  return { capability: Capability.Outpaint, params, outputSize: context.targetSize }
}
