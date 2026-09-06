import type { WorkstationContext, WorkstationGenerationRequest } from '../../types'
import { Capability, type InpaintTaskParams } from '@/types'

export function buildInpaintRequest(
  context: WorkstationContext,
  mode: 'remove' | 'repaint',
): WorkstationGenerationRequest {
  if (!context.maskUrl) throw new Error('请先在图片上创建蒙版')
  const params: InpaintTaskParams = {
    sourceImageUrl: context.sourceAsset.url,
    maskUrl: context.maskUrl,
    mode,
    prompt: mode === 'repaint' ? context.prompt?.trim() : undefined,
  }
  return {
    capability: Capability.Inpaint,
    params,
    outputSize: { width: context.sourceAsset.width, height: context.sourceAsset.height },
  }
}
