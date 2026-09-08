import {
  Capability,
  type ImageToVideoTaskParams,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
  type VariationTaskParams,
} from '@/types'
import type { ImageSizePreset } from './config'

export type CanvasGenerationTaskParams =
  | TextToImageTaskParams
  | TextToVideoTaskParams
  | VariationTaskParams
  | ImageToVideoTaskParams

export interface CanvasGenerationRequest {
  capability: Capability.TextToImage | Capability.TextToVideo | Capability.Variation
  requestId: string
  params: CanvasGenerationTaskParams
}

interface SourceImageInput {
  url: string
  width: number
  height: number
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

export function buildVariationRequest(
  source: SourceImageInput,
  prompt: string,
  count: number,
): CanvasGenerationRequest {
  if (!source.url) throw new Error('源图片不可用')
  const normalizedPrompt = prompt.trim()
  const params: VariationTaskParams = {
    sourceImageUrl: source.url,
    size: { width: source.width, height: source.height },
    count: Math.min(4, Math.max(1, Math.round(count))),
    ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
  }
  return {
    capability: Capability.Variation,
    requestId: crypto.randomUUID(),
    params,
  }
}

export function buildImageToVideoRequest(
  source: SourceImageInput,
  prompt: string,
  durationSeconds: number,
): CanvasGenerationRequest {
  if (!source.url) throw new Error('源图片不可用')
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error('请输入动态描述')
  const params: ImageToVideoTaskParams = {
    sourceImageUrl: source.url,
    prompt: normalizedPrompt,
    size: { width: source.width, height: source.height },
    durationSeconds: durationSeconds === 10 ? 10 : 5,
    count: 1,
  }
  return {
    capability: Capability.TextToVideo,
    requestId: crypto.randomUUID(),
    params,
  }
}
