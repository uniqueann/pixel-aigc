import { i18n } from '@/i18n'
import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'
import { Capability, type InpaintTaskParams } from '@/types'

export function buildInpaintRequest(
  context: WorkstationContext,
  mode: 'remove' | 'repaint',
): WorkstationGenerationRequest {
  if (!context.maskUrl) throw new Error(i18n.t('workstation:errors.createMaskFirst'))
  const params: InpaintTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    maskUrl: context.maskUrl,
    mode,
    prompt: context.prompt?.trim() || undefined,
  }
  return {
    capability: Capability.Inpaint,
    params,
    outputSize: { width: context.sourceAsset.width, height: context.sourceAsset.height },
  }
}
