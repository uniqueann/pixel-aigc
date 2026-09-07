import { Capability, type TextToImageTaskParams } from '@/types'
import type { ImageSizePreset } from './config'

export function buildTextToImageRequest(prompt: string, preset: ImageSizePreset, count: number) {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error('请输入画面描述')

  const params: TextToImageTaskParams = {
    prompt: normalizedPrompt,
    size: { width: preset.width, height: preset.height },
    count: Math.min(4, Math.max(1, Math.round(count))),
  }
  return {
    capability: Capability.TextToImage,
    requestId: crypto.randomUUID(),
    params,
  }
}
