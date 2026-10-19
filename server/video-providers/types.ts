import type { VideoRatio, VideoProviderId, VideoResolution } from '../../shared/video-models.js'
import type { ProviderContext } from '../image-providers/types.js'

export interface VideoSubmitInput {
  model: string
  prompt: string
  durationSeconds: 5 | 10
  resolution: VideoResolution
  ratio: VideoRatio | 'adaptive'
  generateAudio: boolean
  sourceImageUrl?: string
  callbackUrl?: string
  idempotencyKey?: string
}

export type VideoTaskState = {
  model: string
  usage?: Record<string, number>
  generationId?: string
} & (
  | { state: 'queued' | 'processing' }
  | { state: 'succeeded'; videoUrl?: string; videoBytes?: Uint8Array; posterUrl?: string }
  | { state: 'failed'; code: string; message: string }
)

export class VideoProviderError extends Error {
  constructor(public code: string, message: string, public retryable = false, public ambiguous = false) {
    super(message)
    this.name = 'VideoProviderError'
  }
}

export interface VideoProvider {
  readonly id: VideoProviderId
  submit(input: VideoSubmitInput, ctx: ProviderContext): Promise<{ providerTaskId: string; operation?: unknown }>
  getStatus(id: string, ctx: ProviderContext, operation?: unknown): Promise<VideoTaskState>
  fetchResult(url: string, ctx: ProviderContext, maxBytes?: number): Promise<Uint8Array>
}
