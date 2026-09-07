import {
  Capability,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
} from '@/types'
import type { ImageSizePreset } from './config'

export type CanvasGenerationTaskParams = TextToImageTaskParams | TextToVideoTaskParams

export interface CanvasGenerationRequest {
  capability: Capability.TextToImage | Capability.TextToVideo
  requestId: string
  params: CanvasGenerationTaskParams
}

export function buildTextToImageRequest(
  prompt: string,
  preset: ImageSizePreset,
  count: number,
): CanvasGenerationRequest {
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

export function buildTextToVideoRequest(
  prompt: string,
  preset: ImageSizePreset,
  durationSeconds: number,
): CanvasGenerationRequest {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error('请输入画面描述')

  const params: TextToVideoTaskParams = {
    prompt: normalizedPrompt,
    size: { width: preset.width, height: preset.height },
    durationSeconds: durationSeconds === 10 ? 10 : 5,
    count: 1,
  }
  return {
    capability: Capability.TextToVideo,
    requestId: crypto.randomUUID(),
    params,
  }
}
