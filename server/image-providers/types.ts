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
  /** 同一任务里的序号。同步供应商用它做结果去重，避免同一次提交写两张一样的图。 */
  ordinal?: number
}

export type ProviderErrorCode =
  | 'INVALID_KEY'
  | 'INSUFFICIENT_BALANCE'
  | 'RATE_LIMIT'
  | 'CONTENT_REJECTED'
  | 'PROVIDER_FORBIDDEN'
  | 'INVALID_PARAMS'
  | 'TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'BAD_RESPONSE'
  | 'UNKNOWN'

export interface ProviderVendorUsage {
  cost?: number
  /** 成本币种。上游没给时，由模型目录的 vendorCurrency 补上。 */
  currency?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  creditsCost?: number
  expiresAt?: string | number
  outputWidth?: number
  outputHeight?: number
  outputImageCount?: number
  outputImageType?: string
  inputImageCount?: number
  inputImageType?: string
  submitTime?: string
  scheduledTime?: string
  endTime?: string
  /** 多图结果是从响应的哪一段解析出来的。 */
  imageShape?: string
}

/** 任务层轮询节奏。未实现时使用与 GPT-Image-2 相同的默认值。 */
export interface ImageJobPolicy {
  taskTimeoutMs: number
  pollIntervalMs: number
  initialPollDelayMs: number
  maxParallel: number
}

export type ProviderTaskState =
  | { state: 'queued' | 'processing'; progress?: number; raw?: string; vendor?: ProviderVendorUsage }
  | { state: 'succeeded'; resultUrls: string[]; vendor?: ProviderVendorUsage }
  | { state: 'failed'; code: ProviderErrorCode; message: string; retryable: boolean; vendor?: ProviderVendorUsage }

export interface MappedImageRequest {
  providerParams: Record<string, unknown>
  fanOut: number
  warnings: string[]
  expectedAspect?: number
  /** 为 true 时一次上游请求返回 n 张，任务层只提交一次并按序号分配结果。 */
  batch?: boolean
}

export interface ImageProvider {
  readonly id: string
  readonly capabilities: (model: string) => ProviderCapabilities
  configured(env?: NodeJS.ProcessEnv): boolean
  /** 同一供应商下按模型再过滤。未实现时表示该供应商的已配置状态适用于全部模型。 */
  acceptsModel?(model: string, env?: NodeJS.ProcessEnv): boolean
  mapRequest(req: NormalizedImageRequest, model: string): MappedImageRequest
  jobPolicy?(env?: NodeJS.ProcessEnv): ImageJobPolicy
  submit?(input: ProviderSubmitInput, ctx: ProviderContext): Promise<{ providerTaskId: string }>
  getStatus?(providerTaskId: string, ctx: ProviderContext): Promise<ProviderTaskState>
  run?(input: ProviderSubmitInput, ctx: ProviderContext & { deadline: number }): Promise<Uint8Array[]>
  fetchResult(url: string, ctx: ProviderContext): Promise<{ bytes: Uint8Array; mimeType: string }>
}

export class ProviderError extends Error {
  /** false 表示请求字节还没写到连接上，可以安全地再提交一次。未设置表示不确定。 */
  requestSent?: boolean
  /**
   * 上游拒绝了提交且没有创建任务（例如瞬时限流）。
   * 任务层保持 pending，在截止时间前重新提交，避免当成已送出的请求再发一单。
   */
  holdPending?: boolean
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
