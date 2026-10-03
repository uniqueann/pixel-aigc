import type { VideoRatio } from '../../shared/video-models.js'
import type { ProviderContext } from '../image-providers/types.js'

export interface VideoSubmitInput {
  model: string
  prompt: string
  durationSeconds: 5 | 10
  resolution: '720p'
  ratio: VideoRatio | 'adaptive'
  generateAudio: boolean
  sourceImageUrl?: string
  callbackUrl: string
}

export type VideoTaskState = {
  model: string
  usage?: Record<string, number>
} & (
  | { state: 'queued' | 'processing' }
  | { state: 'succeeded'; videoUrl: string; posterUrl?: string }
  | { state: 'failed'; code: string; message: string }
)

export class VideoProviderError extends Error {
  constructor(public code: string, message: string, public retryable = false, public ambiguous = false) {
    super(message)
    this.name = 'VideoProviderError'
  }
}

export interface VideoProvider {
  readonly id: 'seedance'
  submit(input: VideoSubmitInput, ctx: ProviderContext): Promise<{ providerTaskId: string }>
  getStatus(id: string, ctx: ProviderContext): Promise<VideoTaskState>
  fetchResult(url: string, ctx: ProviderContext, maxBytes?: number): Promise<Uint8Array>
}
