import type {
  ImageOperation,
  ImageResolution,
  NormalizedImageRequest,
} from '../../shared/image-generation.js'
import type { SizeMode } from '../../shared/image-models.js'

export type ExecutionMode = 'async' | 'sync-inline'

export interface ProviderCapabilities {
  operations: ImageOperation[]
  supportsMask: boolean
  maxRefImages: number
  maxN: number
  sizeMode: SizeMode
  ratios?: string[]
  resolutions?: ImageResolution[]
  resolutionRatioConstraints?: Partial<Record<ImageResolution, string[]>>
  pixelBounds?: { minEdge: number; maxEdge: number }
  acceptsInput: Array<'url' | 'data'>
  maxInputBytes?: number
  execution: ExecutionMode
}

export interface ProviderContext {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  log: (entry: Record<string, unknown>) => void
  requestId?: string
  signal?: AbortSignal
}

export interface ProviderSubmitInput {
  model: string
  prompt: string
  images: Array<{ url: string }>
  mask?: { url: string }
  providerParams: Record<string, unknown>
}

export type ProviderErrorCode =
  | 'INVALID_KEY'
  | 'INSUFFICIENT_BALANCE'
  | 'RATE_LIMIT'
  | 'CONTENT_REJECTED'
  | 'INVALID_PARAMS'
  | 'TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'BAD_RESPONSE'
  | 'UNKNOWN'

export type ProviderTaskState =
  | { state: 'queued' | 'processing'; progress?: number; raw?: string }
  | { state: 'succeeded'; resultUrls: string[] }
  | { state: 'failed'; code: ProviderErrorCode; message: string; retryable: boolean }

export interface MappedImageRequest {
  providerParams: Record<string, unknown>
  fanOut: number
  warnings: string[]
  expectedAspect?: number
}

export interface ImageProvider {
  readonly id: string
  readonly capabilities: (model: string) => ProviderCapabilities
  configured(env?: NodeJS.ProcessEnv): boolean
  mapRequest(req: NormalizedImageRequest, model: string): MappedImageRequest
  submit?(input: ProviderSubmitInput, ctx: ProviderContext): Promise<{ providerTaskId: string }>
  getStatus?(providerTaskId: string, ctx: ProviderContext): Promise<ProviderTaskState>
  run?(input: ProviderSubmitInput, ctx: ProviderContext & { deadline: number }): Promise<Uint8Array[]>
  fetchResult(url: string, ctx: ProviderContext): Promise<{ bytes: Uint8Array; mimeType: string }>
}

export class ProviderError extends Error {
  constructor(
    public code: ProviderErrorCode,
    message: string,
    public retryable = false,
    public status = 502,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}
