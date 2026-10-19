export const VIDEO_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export type VideoRatio = typeof VIDEO_RATIOS[number]
export type VideoMode = 'text_to_video' | 'image_to_video'
export type VideoPhase = 'submitting' | 'queued' | 'generating' | 'transferring'
export const VIDEO_RESOLUTIONS = ['720p', '768p', '2k'] as const
export type VideoResolution = typeof VIDEO_RESOLUTIONS[number]
export type VideoProviderId = 'seedance' | 'ai-gateway'

export interface VideoModelProfile {
  id: string
  label: string
  provider: VideoProviderId
  vendor?: 'bytedance' | 'minimax'
  model: string
  resolution: VideoResolution
  resolutions?: readonly VideoResolution[]
  modes?: readonly VideoMode[]
  available?: boolean
  unavailableReason?: string | null
  durations: Array<5 | 10>
  ratios: readonly VideoRatio[]
  supportsAudio: boolean
  pricing: {
    version: string
    /** 兼容旧客户端，表示默认分辨率的报价。 */
    creditsPerVideo: Record<5 | 10, number>
    creditsByResolution?: Partial<Record<VideoResolution, Record<5 | 10, number>>>
  }
}

export const SEEDANCE_VIDEO_MODEL: VideoModelProfile = {
  id: 'seedance-2-0-fast', label: 'Seedance 2.0 fast', provider: 'seedance', vendor: 'bytedance',
  model: 'doubao-seedance-2-0-fast-260128', resolution: '720p', durations: [5, 10],
  resolutions: ['720p'], modes: ['text_to_video', 'image_to_video'],
  ratios: VIDEO_RATIOS, supportsAudio: true,
  pricing: { version: 'seedance-fast-720p-v1', creditsPerVideo: { 5: 50, 10: 100 } },
}

export const MINIMAX_H3_VIDEO_MODEL: VideoModelProfile = {
  id: 'minimax-h3', label: 'MiniMax H3', provider: 'ai-gateway', vendor: 'minimax',
  model: 'minimax/minimax-h3', resolution: '768p', resolutions: ['768p', '2k'],
  modes: ['text_to_video'], durations: [5, 10], ratios: VIDEO_RATIOS, supportsAudio: true,
  pricing: { version: 'minimax-h3-video-v1', creditsPerVideo: { 5: 50, 10: 100 },
    creditsByResolution: { '768p': { 5: 50, 10: 100 }, '2k': { 5: 80, 10: 160 } } },
}

/** 保留旧模型的目录顺序，默认选择由画布显式决定。 */
export const VIDEO_MODELS = [SEEDANCE_VIDEO_MODEL, MINIMAX_H3_VIDEO_MODEL] as const
export function videoModel(id: string | undefined) { return VIDEO_MODELS.find(model => model.id === id) }
export function videoModelModes(model: VideoModelProfile) { return model.modes ?? ['text_to_video', 'image_to_video'] as const }
export function videoModelResolutions(model: VideoModelProfile) { return model.resolutions ?? [model.resolution] }
export function videoModelCredits(model: VideoModelProfile | undefined, resolution: VideoResolution, duration: number) {
  if (!model || (duration !== 5 && duration !== 10) || !videoModelResolutions(model).includes(resolution)) return undefined
  const value = model.pricing.creditsByResolution
    ? model.pricing.creditsByResolution[resolution]?.[duration]
    : resolution === model.resolution ? model.pricing.creditsPerVideo[duration] : undefined
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : undefined
}

export interface VideoResultMetadata {
  durationSeconds: number
  sizeBytes: number
  hasAudio: boolean
  videoCodec: string
  audioCodec?: string
  posterKey?: string
  transferStartedAt?: string
  transferAttempts?: number
}

export interface VideoResult {
  url: string
  expiresAt?: number
  objectKey: string
  ordinal: number
  width: number
  height: number
  mimeType: 'video/mp4'
  durationSeconds: number
  sizeBytes: number
  hasAudio: boolean
  posterKey?: string
  retentionExpiresAt: string
}

export const VIDEO_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
