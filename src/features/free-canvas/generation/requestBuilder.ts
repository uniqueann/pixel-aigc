import { VIDEO_REPLICATION_MODEL_ID, VIDEO_REPLICATION_SIZES, type VideoReplicationRatio, type VideoReplicationTaskParams } from '@shared/video-replication'
import type { TaskOrigin } from '@shared/task-center'
import {
  Capability,
  type ImageToVideoTaskParams,
  type TextToImageTaskParams,
  type TextToVideoTaskParams,
  type VariationTaskParams,
} from '@/types'
import type { ImageSizePreset } from './config'
import { VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import { scaleToLongEdge } from '@/features/image-workstation/tools/requestBuilders/imageEdit'
import { i18n } from '@/i18n'
import { videoGenerateAudio, type VideoModelProfile, type VideoRatio, type VideoResolution } from '@shared/video-models'

export type CanvasGenerationTaskParams =
  | TextToImageTaskParams
  | TextToVideoTaskParams
  | VariationTaskParams
  | ImageToVideoTaskParams
  | VideoReplicationTaskParams

export interface CanvasGenerationRequest {
  origin?: TaskOrigin
  capability: Capability.TextToImage | Capability.TextToVideo | Capability.Variation
  requestId: string
  modelProfileId?: string
  priceVersion?: string
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
  options?: { resolution: '1k' | '2k' | '4k'; modelProfileId?: string; enableThinking?: boolean },
): CanvasGenerationRequest {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error(i18n.t('canvas:errors.promptRequired'))

  const params: TextToImageTaskParams = {
    prompt: normalizedPrompt,
    size: options ? scaleToLongEdge(preset.width, preset.height, { '1k': 1024, '2k': 2048, '4k': 4096 }[options.resolution]) : { width: preset.width, height: preset.height },
    count: Math.min(4, Math.max(1, Math.round(count))),
    ...(options ? { resolution: options.resolution } : {}),
    ...(options?.enableThinking !== undefined ? { enableThinking: options.enableThinking } : {}),
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
  options?: { model: VideoModelProfile; generateAudio: boolean; resolution?: VideoResolution },
): CanvasGenerationRequest {
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error(i18n.t('canvas:errors.promptRequired'))
  if (normalizedPrompt.length > VIDEO_PROMPT_MAX) throw new Error(i18n.t('canvas:errors.videoPromptTooLong', { max: VIDEO_PROMPT_MAX }))

  const params: TextToVideoTaskParams = {
    ...(options ? { mode: 'text_to_video' as const, ratio: preset.key as VideoRatio, resolution: options.resolution ?? options.model.resolution, generateAudio: videoGenerateAudio(options.model, options.generateAudio) } : {}),
    prompt: normalizedPrompt,
    size: { width: preset.width, height: preset.height },
    durationSeconds: durationSeconds === 10 ? 10 : 5,
    count: 1,
  }
  return {
    capability: Capability.TextToVideo,
    requestId: crypto.randomUUID(),
    ...(options ? { modelProfileId: options.model.id, priceVersion: options.model.pricing.version } : {}),
    params,
  }
}

export function buildVariationRequest(
  source: SourceImageInput,
  prompt: string,
  count: number,
  options?: { resolution: '1k' | '2k' | '4k'; modelProfileId?: string },
): CanvasGenerationRequest {
  if (!source.url) throw new Error(i18n.t('canvas:errors.sourceImageUnavailable'))
  const normalizedPrompt = prompt.trim()
  if (normalizedPrompt.length > VARIATION_USER_PROMPT_MAX) throw new Error(i18n.t('canvas:errors.variationPromptTooLong', { max: VARIATION_USER_PROMPT_MAX }))
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
  options?: { model: VideoModelProfile; generateAudio: boolean; resolution?: VideoResolution },
): CanvasGenerationRequest {
  if (!source.url) throw new Error(i18n.t('canvas:errors.sourceImageUnavailable'))
  const normalizedPrompt = prompt.trim()
  if (!normalizedPrompt) throw new Error(i18n.t('canvas:errors.motionPromptRequired'))
  if (normalizedPrompt.length > VIDEO_PROMPT_MAX) throw new Error(i18n.t('canvas:errors.videoPromptTooLong', { max: VIDEO_PROMPT_MAX }))
  const params: ImageToVideoTaskParams = {
    ...(options ? { mode: 'image_to_video' as const, ratio: 'adaptive' as const, resolution: options.resolution ?? options.model.resolution, generateAudio: videoGenerateAudio(options.model, options.generateAudio) } : {}),
    sourceImageUrl: source.url,
    prompt: normalizedPrompt,
    size: { width: source.width, height: source.height },
    durationSeconds: durationSeconds === 10 ? 10 : 5,
    count: 1,
  }
  return {
    capability: Capability.TextToVideo,
    requestId: crypto.randomUUID(),
    ...(options ? { modelProfileId: options.model.id, priceVersion: options.model.pricing.version } : {}),
    params,
  }
}

export function buildVideoReplicationRequest(referenceVideoKey: string, prompt: string, ratio: VideoReplicationRatio, durationSeconds: number, priceVersion: string): CanvasGenerationRequest {
  return {
    capability: Capability.TextToVideo, requestId: crypto.randomUUID(), priceVersion, modelProfileId: VIDEO_REPLICATION_MODEL_ID,
    params: { mode: 'video_replication', referenceVideoKey, prompt: prompt.trim(), ratio, durationSeconds,
      size: VIDEO_REPLICATION_SIZES[ratio], count: 1, resolution: '720p', generateAudio: false },
  }
}
