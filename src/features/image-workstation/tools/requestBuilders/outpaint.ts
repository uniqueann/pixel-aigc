import { i18n } from '@/i18n'
import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'
import { Capability, type OutpaintTaskParams } from '@/types'

export function buildOutpaintRequest(context: WorkstationContext): WorkstationGenerationRequest {
  if (!context.maskUrl || !context.targetSize || !context.originOffset) {
    throw new Error(i18n.t('workstation:errors.outpaintCanvasNotReady'))
  }
  const params: OutpaintTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    maskUrl: context.maskUrl,
    targetSize: context.targetSize,
    originOffset: context.originOffset,
  }
  return { capability: Capability.Outpaint, params, outputSize: context.targetSize }
}
