export const VIDEO_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export type VideoRatio = typeof VIDEO_RATIOS[number]
export type VideoMode = 'text_to_video' | 'image_to_video'
export type VideoPhase = 'submitting' | 'queued' | 'generating' | 'transferring'

export interface VideoModelProfile {
  id: string
  label: string
  provider: 'seedance'
  model: string
  resolution: '720p'
  durations: Array<5 | 10>
  ratios: readonly VideoRatio[]
  supportsAudio: boolean
  pricing: { version: string; creditsPerVideo: Record<5 | 10, number> }
}

export const SEEDANCE_VIDEO_MODEL: VideoModelProfile = {
  id: 'seedance-2-0-fast', label: 'Seedance 2.0 fast', provider: 'seedance',
  model: 'doubao-seedance-2-0-fast-260128', resolution: '720p', durations: [5, 10],
  ratios: VIDEO_RATIOS, supportsAudio: true,
  pricing: { version: 'seedance-fast-720p-v1', creditsPerVideo: { 5: 50, 10: 100 } },
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
