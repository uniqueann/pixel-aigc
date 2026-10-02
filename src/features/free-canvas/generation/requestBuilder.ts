import {
  Capability,
  type ImageToVideoTaskParams,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
  type VariationTaskParams,
} from '@/types'
import type { ImageSizePreset } from './config'
import { VARIATION_USER_PROMPT_MAX, variationPromptLimitMessage } from '@shared/variation'
import { scaleToLongEdge } from '@/features/image-workstation/tools/requestBuilders/imageEdit'

export type CanvasGenerationTaskParams =
  | TextToImageTaskParams
  | TextToVideoTaskParams
  | VariationTaskParams
  | ImageToVideoTaskParams

export interface CanvasGenerationRequest {
  capability: Capability.TextToImage | Capability.TextToVideo | Capability.Variation
  requestId: string
  modelProfileId?: string
  params: CanvasGenerationTaskParams
}

interface SourceImageInput {
  url: string
  width: number
  height: number
  objectKey?: string
  storage?: { objectKey: string }
}

export function buildTextToImageRequest(
  prompt: string,
  preset: ImageSizePreset,
  count: number,
  options?: { resolution: '1k' | '2k' | '4k'; modelProfileId?: string },
): CanvasGenerationRequest {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error('请输入画面描述')

  const params: TextToImageTaskParams = {
    prompt: normalizedPrompt,
    size: options ? scaleToLongEdge(preset.width, preset.height, { '1k': 1024, '2k': 2048, '4k': 4096 }[options.resolution]) : { width: preset.width, height: preset.height },
    count: Math.min(4, Math.max(1, Math.round(count))),
    ...(options ? { resolution: options.resolution } : {}),
  }
  return {
    capability: Capability.TextToImage,
    requestId: crypto.randomUUID(),
    ...(options?.modelProfileId ? { modelProfileId: options.modelProfileId } : {}),
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
  options?: { resolution: '1k' | '2k' | '4k'; modelProfileId?: string },
): CanvasGenerationRequest {
  if (!source.url) throw new Error('源图片不可用')
  const normalizedPrompt = prompt.trim()
  if (normalizedPrompt.length > VARIATION_USER_PROMPT_MAX) throw new Error(variationPromptLimitMessage())
  const params: VariationTaskParams = {
    sourceImageUrl: source.url,
    size: options ? scaleToLongEdge(source.width, source.height, { '1k': 1024, '2k': 2048, '4k': 4096 }[options.resolution]) : { width: source.width, height: source.height },
    count: Math.min(4, Math.max(1, Math.round(count))),
    ...(normalizedPrompt ? { prompt: normalizedPrompt } : {}),
    ...(options ? { resolution: options.resolution, sourceWidth: source.width, sourceHeight: source.height } : {}),
  }
  return {
    capability: Capability.Variation,
    requestId: crypto.randomUUID(),
    ...(options?.modelProfileId ? { modelProfileId: options.modelProfileId } : {}),
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
