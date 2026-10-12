import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { authenticate } from '../auth.js'
import { runtimeScope, withIdentity } from '../db.js'
import { describeError, HttpError } from '../errors.js'
import { requireActive } from '../members.js'
import { getObject, putObject, signRead } from '../storage.js'
import type { NormalizedImageRequest } from '../../shared/image-generation.js'
import {
  FUSION_NOTE_MAX,
  composeFusionPrompt,
  fusionNoteLimitMessage,
} from '../../shared/fusion.js'
import {
  RELIGHT_DIRECTIONS,
  RELIGHT_NOTE_MAX,
  RELIGHT_QUALITIES,
  RELIGHT_TEMPERATURES,
  composeRelightPrompt,
  fitRelightNote,
  readRelight,
  relightNoteLimitMessage,
} from '../../shared/relight.js'
import {
  RETOUCH_DIRECTION_IDS,
  RETOUCH_NOTE_MAX,
  composeRetouchPrompt,
  normalizeRetouchDirections,
  retouchNoteLimitMessage,
} from '../../shared/retouch.js'
import { PROMPT_MAX_LENGTH } from '../../shared/prompt-limits.js'
import {
  VARIATION_USER_PROMPT_MAX,
  composeVariationPrompt,
  variationPromptLimitMessage,
} from '../../shared/variation.js'
import { findImageModel, referenceImageLimitMessage } from '../../shared/image-models.js'
import { qwenImageConcurrencyLimits, qwenThrottleBackoffMs, qwenUsesTightRpm } from '../image-providers/qwen-image/config.js'
import {
  QWEN_QUEUE_FULL_MESSAGE,
  QWEN_THROTTLE_REFUND_MESSAGE,
} from '../image-providers/qwen-image/errors.js'
import { configuredImageModels, imageProviderById } from '../image-providers/registry.js'
import {
  ProviderError,
  type ImageJobPolicy,
  type ImageProvider,
  type ProviderContext,
  type ProviderVendorUsage,
} from '../image-providers/types.js'
import {
  DRAGONCODE_MAX_DATA_URI_BYTES,
  SOURCE_PRESIGN_TTL_SECONDS,
} from '../image-providers/dragoncode/config.js'
import { describeReferenceUrl } from '../image-providers/dragoncode/images.js'
import { retryBackoffMs, sleep as defaultSleep } from '../image-providers/http.js'
import { cropToSourceAspect } from './aspect-crop.js'
import { createSqlBilling, noopBilling, type BillingPort } from './billing.js'
import { reserveAndCreateJob } from './lifecycle.js'
import { VIDEO_RETENTION_MS } from '../../shared/video-models.js'
import { createSqlStore } from './repository.js'
import { ImageLeaseLost, sqlImageExecution, type ImageExecutionPort } from './execution.js'
import { getDeadline } from '@vercel/functions'
import { taskOriginSchema, validTaskOrigin } from '../../shared/task-center.js'
import {
  ACTIVE_JOB_STATUSES,
  LATE_RESULT_WARNING,
  POLLABLE_ITEM_STATUSES,
  canSalvage,
  mergeWarnings,
  nextPollAt,
  reduceJobStatus,
  shouldAdvance,
  toClientTaskStatus,
} from './state.js'
import {
  IMAGE_TASK_USER_CONCURRENCY_MESSAGE,
  USER_CONCURRENCY_RETRY_AFTER,
  hourlyRetryAfterSeconds,
  imageTaskHourlyRateLimitMessage,
  rateLimitExtra,
  rateLimitWaitMinutes,
} from '../../shared/rate-limit.js'
import type { ImageJobBundle, ImageJobItemRow, ImageJobRow, ImageJobStore, InsertImageJobInput } from './types.js'

type User = Awaited<ReturnType<typeof authenticate>>

export const IMAGE_HOURLY_LIMIT = 20
export const IMAGE_USER_CONCURRENCY = 2
export const IMAGE_GLOBAL_CONCURRENCY = 20
/** 一次任务最多 4 张，下载和写 R2 同时进行，但不超过这个上限。 */
const RESULT_DOWNLOAD_PARALLEL = 4
const VENDOR_COST_SCALE = 1_000_000
export const IMAGE_LEASE_MS = 120_000
/** 明确的 502/503 且响应没有任务号：同一次提交里最多再 POST 这么多次。生产未开后台补提交。 */
export const GATEWAY_REJECTION_RETRIES = 2
/** 无任务号、缓存也恢复不了时，不必再等满生成截止。短于各供应商默认同步超时，且发生在租约释放之后。 */
export const UNKNOWN_SUBMISSION_GRACE_MS = 75_000
const GATEWAY_REJECTED_MESSAGE = '图片服务暂时不可用，请稍后重试（积分已退回）'
/** 与 GPT-Image-2 现有默认值一致。供应商未提供 jobPolicy 时使用。 */
export const DEFAULT_IMAGE_JOB_POLICY: ImageJobPolicy = {
  taskTimeoutMs: 300_000,
  pollIntervalMs: 5_000,
  initialPollDelayMs: 5_000,
  maxParallel: 4,
}

export function imageJobPolicy(provider: ImageProvider, env: NodeJS.ProcessEnv = process.env): ImageJobPolicy {
  return provider.jobPolicy?.(env) ?? DEFAULT_IMAGE_JOB_POLICY
}
export const IMAGE_TASK_CAPABILITIES = new Set(['image_edit', 'variation', 'text_to_image'])

const uuid = z.uuid()
const imageSize = z.object({
  width: z.number().int().positive().max(20000),
  height: z.number().int().positive().max(20000),
})
const imageSourceParams = {
  sourceImageKey: z.string().trim().min(1).max(512),
  sourceImageUrl: z.string().max(4000).optional(),
  count: z.number().int().min(1).max(4),
  resolution: z.enum(['1k', '2k', '4k']),
  size: imageSize.optional(),
  sourceWidth: z.number().int().positive().max(20000).optional(),
  sourceHeight: z.number().int().positive().max(20000).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}
const imageEditParams = z.object({
  ...imageSourceParams,
  prompt: z.string().trim().max(PROMPT_MAX_LENGTH).optional(),
  retouchDirections: z.array(z.enum(RETOUCH_DIRECTION_IDS)).max(4).optional(),
  referenceImageKey: z.string().trim().min(1).max(512).optional(),
  referenceImageUrl: z.string().max(4000).optional(),
  relight: z.object({
    direction: z.enum(RELIGHT_DIRECTIONS),
    quality: z.enum(RELIGHT_QUALITIES),
    temperature: z.enum(RELIGHT_TEMPERATURES),
  }).optional(),
}).strict().superRefine((value, ctx) => {
  const directions = normalizeRetouchDirections(value.retouchDirections)
  const note = value.prompt?.trim() ?? ''
  const referenceKey = value.referenceImageKey?.trim() ?? ''
  const relight = value.relight
  if (relight && (directions.length > 0 || referenceKey)) {
    ctx.addIssue({ code: 'custom', message: '不能同时提交重新打光和其他编辑', path: ['relight'] })
    return
  }
  if (relight) {
    if (note.length > RELIGHT_NOTE_MAX) {
      ctx.addIssue({ code: 'custom', message: relightNoteLimitMessage(), path: ['prompt'] })
    }
    return
  }
  if (referenceKey && directions.length > 0) {
    ctx.addIssue({ code: 'custom', message: '不能同时提交精修和融合', path: ['referenceImageKey'] })
    return
  }
  if (referenceKey) {
    if (note.length > FUSION_NOTE_MAX) {
      ctx.addIssue({ code: 'custom', message: fusionNoteLimitMessage(), path: ['prompt'] })
    }
    if (referenceKey === value.sourceImageKey) {
      ctx.addIssue({ code: 'custom', message: '商品图和场景图不能是同一张', path: ['referenceImageKey'] })
    }
    return
  }
  if (directions.length > 0) {
    if (note.length > RETOUCH_NOTE_MAX) {
      ctx.addIssue({ code: 'custom', message: retouchNoteLimitMessage(), path: ['prompt'] })
    }
    return
  }
  if (!note) ctx.addIssue({ code: 'custom', message: '请填写编辑要求', path: ['prompt'] })
})
const variationParams = z.object({
  ...imageSourceParams,
  prompt: z.string().trim().max(VARIATION_USER_PROMPT_MAX).optional(),
}).strict()
const textToImageParams = z.object({
  prompt: z.string().trim().min(1, '请填写画面描述').max(PROMPT_MAX_LENGTH, `画面描述不能超过 ${PROMPT_MAX_LENGTH} 字`),
  size: imageSize.strict(),
  count: z.number().int().min(1).max(4),
  resolution: z.enum(['1k', '2k', '4k']),
  /** 千问「自动扩写」。GPT Image 2 接受该字段但忽略，不写入供应商参数。 */
  enableThinking: z.boolean().optional(),
}).strict()

export const createImageTaskSchema = z.discriminatedUnion('capability', [
  z.object({
    capability: z.literal('image_edit'),
    origin: taskOriginSchema.optional(),
    requestId: uuid,
    params: imageEditParams,
    modelProfileId: z.string().optional(),
  }).strict(),
  z.object({
    capability: z.literal('variation'),
    origin: taskOriginSchema.optional(),
    requestId: uuid,
    params: variationParams,
    modelProfileId: z.string().optional(),
  }).strict(),
  z.object({
    capability: z.literal('text_to_image'),
    origin: taskOriginSchema.optional(),
    requestId: uuid,
    params: textToImageParams,
    modelProfileId: z.string().optional(),
  }).strict(),
]).superRefine((value,ctx) => {
  if (!validTaskOrigin(value.origin,value.capability)) ctx.addIssue({ code: 'custom',message: '任务来源与生成能力不匹配',path: ['origin'] })
})

type ImageTaskCapability = 'image_edit' | 'variation' | 'text_to_image'
type StoredImageParams = {
  prompt?: string
  sourceImageKey?: string
  referenceImageKey?: string
  sourceWidth?: number
  sourceHeight?: number
  size?: { width: number; height: number }
}

export function assertVariationSteerLimit(body: unknown) {
  if (!isRecord(body) || body.capability !== 'variation' || !isRecord(body.params)) return
  const prompt = body.params.prompt
  if (typeof prompt !== 'string') return
  if (prompt.trim().length > VARIATION_USER_PROMPT_MAX) {
    throw new HttpError(400, variationPromptLimitMessage(), 'INVALID_PARAMS')
  }
}

export function assertRelightRequest(body: unknown) {
  if (!isRecord(body) || body.capability !== 'image_edit' || !isRecord(body.params)) return
  if (!readRelight(body.params)) return
  const prompt = body.params.prompt
  if (typeof prompt !== 'string') return
  if (prompt.trim().length > RELIGHT_NOTE_MAX) {
    throw new HttpError(400, relightNoteLimitMessage(), 'INVALID_PARAMS')
  }
}

export function assertFusionRequest(body: unknown) {
  if (!isRecord(body) || body.capability !== 'image_edit' || !isRecord(body.params)) return
  const reference = typeof body.params.referenceImageKey === 'string' ? body.params.referenceImageKey.trim() : ''
  if (!reference) return
  const source = typeof body.params.sourceImageKey === 'string' ? body.params.sourceImageKey.trim() : ''
  const prompt = typeof body.params.prompt === 'string' ? body.params.prompt.trim() : ''
  if (prompt.length > FUSION_NOTE_MAX) {
    throw new HttpError(400, fusionNoteLimitMessage(), 'INVALID_PARAMS')
  }
  if (source && reference === source) {
    throw new HttpError(400, '商品图和场景图不能是同一张', 'INVALID_SOURCE')
  }
}

export function assertRetouchNoteLimit(body: unknown) {
  if (!isRecord(body) || body.capability !== 'image_edit' || !isRecord(body.params)) return
  const directions = body.params.retouchDirections
  if (!Array.isArray(directions) || normalizeRetouchDirections(directions.filter((item): item is string => typeof item === 'string')).length === 0) return
  const prompt = body.params.prompt
  if (typeof prompt !== 'string') return
  if (prompt.trim().length > RETOUCH_NOTE_MAX) {
    throw new HttpError(400, retouchNoteLimitMessage(), 'INVALID_PARAMS')
  }
}

export interface ImageJobRuntime {
  now: () => number
  sleep: (ms: number) => Promise<void>
  fetch: typeof fetch
  log: (entry: Record<string, unknown>) => void
  signRead: (key: string, expiresIn?: number) => Promise<{ url: string; expiresAt: number }>
  putObject: (key: string, bytes: Uint8Array, contentType: string, signal?: AbortSignal) => Promise<void>
  getObject: (key: string, signal?: AbortSignal) => Promise<{ bytes: Uint8Array; contentType?: string }>
  billing: BillingPort
  crop: typeof cropToSourceAspect
  providerFor: (id: string) => ImageProvider | undefined
  /** 限流退避的抖动。缺省用 Math.random。 */
  random?: () => number
  execution?: ImageExecutionPort
  signal?: AbortSignal
  budgetUntil?: number
  allowSubmit?: boolean
}

type ItemPatch = Partial<ImageJobItemRow>
type SubmitOutcome = {
  ordinal: number
  patch: ItemPatch
  vendor?: ProviderVendorUsage
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function vendorItemRecord(vendor: ProviderVendorUsage) {
  return {
    cost: vendor.cost,
    credits_cost: vendor.creditsCost,
    expires_at: vendor.expiresAt,
    ...(vendor.currency ? { currency: vendor.currency } : {}),
    ...(vendor.promptTokens !== undefined ? { prompt_tokens: vendor.promptTokens } : {}),
    ...(vendor.completionTokens !== undefined ? { completion_tokens: vendor.completionTokens } : {}),
    ...(vendor.totalTokens !== undefined ? { total_tokens: vendor.totalTokens } : {}),
    ...(vendor.outputWidth !== undefined ? { output_width: vendor.outputWidth } : {}),
    ...(vendor.outputHeight !== undefined ? { output_height: vendor.outputHeight } : {}),
    ...(vendor.outputImageCount !== undefined ? { output_image_count: vendor.outputImageCount } : {}),
    ...(vendor.outputImageType !== undefined ? { output_image_type: vendor.outputImageType } : {}),
    ...(vendor.inputImageCount !== undefined ? { input_image_count: vendor.inputImageCount } : {}),
    ...(vendor.inputImageType !== undefined ? { input_image_type: vendor.inputImageType } : {}),
    ...(vendor.submitTime ? { submit_time: vendor.submitTime } : {}),
    ...(vendor.scheduledTime ? { scheduled_time: vendor.scheduledTime } : {}),
    ...(vendor.endTime ? { end_time: vendor.endTime } : {}),
    ...(vendor.imageShape ? { image_shape: vendor.imageShape } : {}),
  }
}

export function mergeVendorUsage(
  providerParams: Record<string, unknown>,
  outcomes: SubmitOutcome[],
) {
  const previous = isRecord(providerParams.vendor) ? providerParams.vendor : {}
  const items = isRecord(previous.items) ? { ...previous.items } : {}
  for (const outcome of outcomes) {
    if (!outcome.vendor) continue
    items[String(outcome.ordinal)] = vendorItemRecord(outcome.vendor)
  }
  let cost = 0
  let creditsCost = 0
  let currency: string | undefined
  for (const value of Object.values(items)) {
    if (!isRecord(value)) continue
    if (typeof value.cost === 'number') cost += value.cost
    if (typeof value.credits_cost === 'number') creditsCost += value.credits_cost
    if (!currency && typeof value.currency === 'string') currency = value.currency
  }
  return {
    ...providerParams,
    vendor: { cost, credits_cost: creditsCost, ...(currency ? { currency } : {}), items },
  }
}

function scaledVendorCost(unitRaw: string, count: number) {
  const unit = Number(unitRaw)
  if (!Number.isFinite(unit) || unit < 0 || !Number.isInteger(count) || count <= 0) return undefined
  return Math.round(unit * VENDOR_COST_SCALE) * count
}

/**
 * 上游没回传金额时，用模型目录的单价乘以本次实际返回的张数。
 * 已有 cost（包括 0）保持不变，避免盖掉 DragonCode 的账单。
 */
export function applyCatalogVendorCost(
  job: Pick<ImageJobRow, 'model_profile_id' | 'provider_params'>,
  vendor: ProviderVendorUsage | undefined,
  returnedCount: number,
): ProviderVendorUsage | undefined {
  if (vendor?.cost !== undefined) return vendor
  const profile = findImageModel(job.model_profile_id)
  // 只补标了币种的目录价。GPT Image 2 的账单仍以上游返回的 cost 为准。
  if (!profile?.pricing.vendorCurrency) return vendor
  const resolution = job.provider_params.resolution
  const unitRaw = resolution === '1k' || resolution === '2k' || resolution === '4k'
    ? profile.pricing.vendorCost?.[resolution]
    : undefined
  const outputScaled = unitRaw ? scaledVendorCost(unitRaw, returnedCount) : undefined
  const inputCount = vendor?.inputImageCount
  const inputScaled = profile.pricing.vendorInputImageCost && inputCount
    ? scaledVendorCost(profile.pricing.vendorInputImageCost, inputCount)
    : undefined
  if (outputScaled === undefined && inputScaled === undefined) return vendor
  const cost = ((outputScaled ?? 0) + (inputScaled ?? 0)) / VENDOR_COST_SCALE
  return { ...vendor, cost, currency: profile.pricing.vendorCurrency }
}

export function defaultImageJobRuntime(): ImageJobRuntime {
  return {
    now: () => Date.now(),
    sleep: defaultSleep,
    fetch: globalThis.fetch,
    log: (entry) => {
      if (process.env.VITEST) return
      console.info(JSON.stringify({ evt: 'image-job', region: process.env.VERCEL_REGION ?? null, ...entry }))
    },
    signRead,
    putObject,
    getObject,
    billing: noopBilling,
    crop: cropToSourceAspect,
    providerFor: imageProviderById,
  }
}

export function isSafeObjectKey(userId: string, key: string) {
  if (!key || key.includes('..') || key.includes('\\') || key.startsWith('/') || key.includes('//')) return false
  const generatedPrefix = `generated/${userId}/`
  if (key.startsWith(generatedPrefix)) {
    const scoped = /^(local|preview|production)\//.exec(key.slice(generatedPrefix.length))
    if (scoped && scoped[1] !== runtimeScope()) return false
  }
  return [
    `temporary/task-inputs/${userId}/`,
    `temporary/erase-results/${userId}/`,
    `temporary/repaint-results/${userId}/`,
    `temporary/outpaint-results/${userId}/`,
    `temporary/bg-remove-results/${userId}/`,
    `generated/${userId}/`,
    `media/${userId}/`,
  ].some(prefix => key.startsWith(prefix) && key.length > prefix.length)
}

function extensionFor(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function iso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function sourceDimensions(params: StoredImageParams) {
  if (params.sourceWidth && params.sourceHeight) return { width: params.sourceWidth, height: params.sourceHeight }
  if (params.size) return params.size
  return { width: 1, height: 1 }
}

function imageModelUnavailable(operation: ImageTaskCapability) {
  const labels = {
    variation: ['裂变', 'VARIATION_UNAVAILABLE'],
    image_edit: ['智能编辑', 'IMAGE_EDIT_UNAVAILABLE'],
    text_to_image: ['文生图', 'TEXT_TO_IMAGE_UNAVAILABLE'],
  } as const
  const [label, code] = labels[operation]
  return new HttpError(503, `${label}尚未配置可用的图片模型`, code)
}

function providerContext(runtime: ImageJobRuntime, job: ImageJobRow, attemptId?: string): ProviderContext {
  return { fetch: runtime.fetch, sleep: runtime.sleep, now: runtime.now, log: runtime.log, requestId: job.request_id,
    signal: runtime.signal,
    ...(attemptId ? { execution: { userId: job.user_id,scope: job.scope,jobId: job.id,attemptId } } : {}) }
}

/** 总预算与单次操作的超时分别生效，留出数据库收尾时间。 */
export function boundedImageRuntime(runtime: ImageJobRuntime, budgetMs: number): ImageJobRuntime {
  const platformDeadline = getDeadline()
  const budgetUntil = Math.min(runtime.now() + budgetMs, platformDeadline ? platformDeadline.getTime() - 8_000 : Infinity,
    runtime.budgetUntil ?? Infinity)
  const timeout = AbortSignal.timeout(Math.max(1, Math.floor(budgetUntil - runtime.now())))
  return { ...runtime, budgetUntil, signal: runtime.signal ? AbortSignal.any([runtime.signal,timeout]) : timeout }
}

function resolveModel(operation: ImageTaskCapability, modelProfileId: string | undefined, env = process.env) {
  const available = configuredImageModels(operation, env)
  const profile = modelProfileId
    ? available.find(item => item.id === modelProfileId)
    : available.find(item => item.defaultFor?.includes(operation)) ?? available[0]
  if (!profile) throw imageModelUnavailable(operation)
  return profile
}

function submittedPrompt(providerParams: Record<string, unknown>, params: StoredImageParams) {
  const composed = providerParams.prompt
  if (typeof composed === 'string' && composed.trim()) return composed
  return params.prompt ?? ''
}

async function resolveInputUrl(objectKey: string, runtime: ImageJobRuntime) {
  try {
    const signed = await runtime.signRead(objectKey, SOURCE_PRESIGN_TTL_SECONDS)
    runtime.log({
      stage: 'source-url',
      expiresIn: SOURCE_PRESIGN_TTL_SECONDS,
      ...describeReferenceUrl(signed.url),
    })
    return signed.url
  } catch (error) {
    runtime.log({ stage: 'source-sign-failed', error: error instanceof Error ? error.message : String(error) })
    const object = await runtime.getObject(objectKey,runtime.signal)
    if (object.bytes.byteLength > DRAGONCODE_MAX_DATA_URI_BYTES) {
      throw new ProviderError('INVALID_PARAMS', '参考图超过 20MB 限制', false, 400)
    }
    const mime = object.contentType?.startsWith('image/') ? object.contentType : ''
    if (!mime) throw new ProviderError('INVALID_PARAMS', '参考图必须是图片格式', false, 400)
    return `data:${mime};base64,${Buffer.from(object.bytes).toString('base64')}`
  }
}

async function mapPool<T>(count: number, limit: number, worker: (index: number) => Promise<T>) {
  const results: T[] = new Array(count)
  let next = 0
  async function run() {
    while (next < count) {
      const index = next
      next += 1
      results[index] = await worker(index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, count) }, () => run()))
  return results
}

export async function createImageJobInStore(
  store: ImageJobStore,
  user: User,
  parsed: z.infer<typeof createImageTaskSchema>,
  runtime: ImageJobRuntime,
): Promise<{ bundle: ImageJobBundle; created: boolean; provider: ImageProvider }> {
  if (store.kind === 'memory') {
    (store as ImageJobStore & { setClock(clock: () => number): void }).setClock(() => runtime.now())
    runtime.execution ??= { transaction: action => action(store,runtime.billing) }
  }
  await store.expireUserOverdue(new Date(runtime.now()))
  const profile = resolveModel(parsed.capability, parsed.modelProfileId)
  const provider = runtime.providerFor(profile.provider)
  if (!provider) throw imageModelUnavailable(parsed.capability)
  const userPrompt = parsed.params.prompt?.trim() ?? ''
  const retouchDirections = parsed.capability === 'image_edit'
    ? normalizeRetouchDirections(parsed.params.retouchDirections)
    : []
  const isRetouch = retouchDirections.length > 0
  const referenceKey = parsed.capability === 'image_edit' ? parsed.params.referenceImageKey?.trim() ?? '' : ''
  const isFusion = referenceKey.length > 0
  const relight = parsed.capability === 'image_edit' ? readRelight(parsed.params) : undefined
  const isRelight = relight !== undefined
  const sourceKey = parsed.capability === 'text_to_image' ? undefined : parsed.params.sourceImageKey
  if (isRelight && (isRetouch || isFusion)) throw new HttpError(400, '不能同时提交重新打光和其他编辑', 'INVALID_PARAMS')
  if (isFusion && isRetouch) throw new HttpError(400, '不能同时提交精修和融合', 'INVALID_PARAMS')
  if (parsed.capability === 'variation' && userPrompt.length > VARIATION_USER_PROMPT_MAX) {
    throw new HttpError(400, variationPromptLimitMessage(), 'INVALID_PARAMS')
  }
  if (isRelight && userPrompt.length > RELIGHT_NOTE_MAX) {
    throw new HttpError(400, relightNoteLimitMessage(), 'INVALID_PARAMS')
  }
  if (isFusion && userPrompt.length > FUSION_NOTE_MAX) {
    throw new HttpError(400, fusionNoteLimitMessage(), 'INVALID_PARAMS')
  }
  if (isRetouch && userPrompt.length > RETOUCH_NOTE_MAX) {
    throw new HttpError(400, retouchNoteLimitMessage(), 'INVALID_PARAMS')
  }
  if (parsed.capability === 'image_edit' && !isRetouch && !isFusion && !isRelight && !userPrompt) {
    throw new HttpError(400, '请填写编辑要求', 'INVALID_PARAMS')
  }
  if (parsed.capability === 'image_edit' && !isRetouch && !isFusion && !isRelight && userPrompt.length > (profile.ui.promptMaxLength ?? PROMPT_MAX_LENGTH)) {
    throw new HttpError(400, '编辑要求过长', 'INVALID_PARAMS')
  }
  if (parsed.capability === 'text_to_image' && (!userPrompt || userPrompt.length > (profile.ui.promptMaxLength ?? PROMPT_MAX_LENGTH))) {
    throw new HttpError(400, userPrompt ? '画面描述过长' : '请填写画面描述', 'INVALID_PARAMS')
  }
  if (isFusion && referenceKey === sourceKey) {
    throw new HttpError(400, '商品图和场景图不能是同一张', 'INVALID_SOURCE')
  }
  if (isFusion && !isSafeObjectKey(user.id, referenceKey)) {
    throw new HttpError(400, '场景图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const modelPromptMax = profile.ui.promptMaxLength ?? PROMPT_MAX_LENGTH
  const relightNote = isRelight ? fitRelightNote(userPrompt, modelPromptMax) : ''
  const prompt = parsed.capability === 'variation'
    ? composeVariationPrompt(userPrompt)
    : isFusion
      ? composeFusionPrompt(userPrompt)
      : isRelight
        ? composeRelightPrompt(relight, relightNote)
        : isRetouch
          ? composeRetouchPrompt(retouchDirections, userPrompt)
          : parsed.params.prompt ?? ''
  const storedParams = isRetouch
    ? {
        ...parsed.params,
        retouchDirections,
        ...(userPrompt ? { prompt: userPrompt } : {}),
      }
    : isFusion
      ? {
          ...parsed.params,
          referenceImageKey: referenceKey,
          ...(userPrompt ? { prompt: userPrompt } : {}),
        }
      : isRelight
        ? {
            ...parsed.params,
            relight,
            ...(relightNote ? { prompt: relightNote } : {}),
          }
        : parsed.params
  if (isRelight ? !relightNote : (isRetouch || isFusion) && !userPrompt) delete storedParams.prompt
  if (parsed.params.count > profile.ui.maxCount) {
    throw new HttpError(400, `最多生成 ${profile.ui.maxCount} 张`, 'INVALID_PARAMS')
  }
  if (parsed.capability === 'text_to_image' && !profile.ui.resolutions.includes(parsed.params.resolution)) {
    throw new HttpError(400, '当前模型不支持所选分辨率，请重新选择', 'INVALID_PARAMS')
  }
  if (parsed.capability !== 'text_to_image' && (!sourceKey || !isSafeObjectKey(user.id, sourceKey))) {
    throw new HttpError(400, '原图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const dimensions = sourceDimensions(parsed.params)
  const normalized: NormalizedImageRequest = {
    operation: parsed.capability,
    prompt,
    images: sourceKey ? [
      {
        source: { kind: 'r2', objectKey: sourceKey },
        width: dimensions.width,
        height: dimensions.height,
      },
      ...(isFusion ? [{ source: { kind: 'r2' as const, objectKey: referenceKey } }] : []),
    ] : [],
    target: { size: parsed.params.size, resolution: parsed.params.resolution },
    count: parsed.params.count,
    extra: parsed.capability === 'text_to_image'
      ? (parsed.params.enableThinking === undefined ? undefined : { enableThinking: parsed.params.enableThinking })
      : parsed.params.extra,
  }
  if (normalized.images.length > profile.ui.maxRefImages) {
    throw new HttpError(400, referenceImageLimitMessage(profile.ui.maxRefImages), 'INVALID_PARAMS')
  }
  const mapped = provider.mapRequest(normalized, profile.model)
  if (parsed.capability === 'variation' || isRetouch || isFusion || isRelight) {
    mapped.providerParams = { ...mapped.providerParams, prompt }
  }
  const fingerprint = createHash('sha256').update(JSON.stringify({
    params: storedParams, modelProfileId: profile.id,
  })).digest('hex')
  const existing = await store.findByRequestId(parsed.requestId)
  if (existing) {
    if (existing.capability !== parsed.capability || existing.request_fingerprint !== fingerprint) {
      throw new HttpError(409, '请求标识已用于其他图片任务', 'REQUEST_CONFLICT')
    }
    return { bundle: { job: existing, items: await store.listItems(existing.id) }, created: false, provider }
  }
  if (await store.hourlyCount() >= IMAGE_HOURLY_LIMIT) {
    const seconds = hourlyRetryAfterSeconds(await store.hourlyOldest())
    throw new HttpError(429, imageTaskHourlyRateLimitMessage(IMAGE_HOURLY_LIMIT, rateLimitWaitMinutes(seconds)), 'RATE_LIMIT', {
      extra: rateLimitExtra(seconds),
    })
  }
  if (await store.userActiveCount() >= IMAGE_USER_CONCURRENCY) {
    throw new HttpError(429, IMAGE_TASK_USER_CONCURRENCY_MESSAGE, 'USER_CONCURRENCY', {
      extra: rateLimitExtra(USER_CONCURRENCY_RETRY_AFTER),
    })
  }
  if (await store.globalActiveCount() >= IMAGE_GLOBAL_CONCURRENCY) {
    throw new HttpError(429, '服务当前任务较多，请稍后重试', 'GLOBAL_CONCURRENCY')
  }
  await assertBailianImageCapacity(store, profile)
  const policy = imageJobPolicy(provider)
  const timeoutMs = policy.taskTimeoutMs
  const jobId = randomUUID()
  const effectiveResolution = mapped.providerParams.resolution as '1k' | '2k' | '4k'
  const unitPrice = profile.pricing.creditsPerImage[effectiveResolution]
  if (!Number.isSafeInteger(unitPrice) || !unitPrice || unitPrice <= 0) {
    throw new HttpError(503, '图片积分单价尚未配置', 'IMAGE_PRICE_UNAVAILABLE')
  }
  const reserved = mapped.fanOut * unitPrice
  const input: InsertImageJobInput = {
    id: jobId,
    requestId: parsed.requestId,
    fingerprint,
    origin: parsed.origin,
    capability: parsed.capability,
    modelProfileId: profile.id,
    provider: profile.provider,
    params: storedParams,
    providerParams: mapped.providerParams,
    warnings: mapped.warnings,
    requestedCount: mapped.fanOut,
    creditsReserved: reserved,
    billingState: 'reserved',
    deadlineAt: new Date(runtime.now() + timeoutMs),
    nextPollAt: nextPollAt(runtime.now(), policy.pollIntervalMs, true, policy.initialPollDelayMs),
    initialLease: true,
  }
  const bundle = await reserveAndCreateJob(store, runtime.billing, user.id, input,
    { capability: parsed.capability, modelProfileId: profile.id, resolution: effectiveResolution, unitPrice })
  return { bundle, created: true, provider }
}

async function assertBailianImageCapacity(
  store: ImageJobStore,
  profile: { provider: string; id: string; model: string },
) {
  if (profile.provider !== 'bailian') return
  const limits = qwenImageConcurrencyLimits()
  if (await store.providerActiveCount(profile.provider) >= limits.providerActive) {
    throw new HttpError(429, QWEN_QUEUE_FULL_MESSAGE, 'PROVIDER_CONCURRENCY', {
      extra: rateLimitExtra(15),
    })
  }
  if (qwenUsesTightRpm(profile.model) && await store.modelActiveCount(profile.id) >= limits.proActive) {
    throw new HttpError(429, QWEN_QUEUE_FULL_MESSAGE, 'MODEL_CONCURRENCY', {
      extra: rateLimitExtra(15),
    })
  }
}

function nextPollInterval(job: ImageJobRow, runtime: ImageJobRuntime) {
  if (job.capability === 'text_to_video') return 60_000
  const provider = runtime.providerFor(job.provider)
  return provider ? imageJobPolicy(provider).pollIntervalMs : DEFAULT_IMAGE_JOB_POLICY.pollIntervalMs
}

function submittedPatch(item: ImageJobItemRow, providerTaskId: string): ItemPatch {
  return {
    status: 'submitted',
    provider_task_id: providerTaskId,
    attempts: item.attempts + 1,
    error_code: null,
    error_message: null,
  }
}

function submitFailureMessage(message: string) {
  return message
    .replace(/data:[^,\s]*;base64,[A-Za-z0-9+/_=-]+/gi, '[图片数据已隐藏]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
    .replace(/https?:\/\/[^\s"'<>]+/gi,'[地址已隐藏]')
    .slice(0, 300)
}

/** 私有尝试凭据只保存错误分类，避免上游原文夹带提示词、图片或凭证。 */
function submissionReceiptMessage(code: ProviderError['code']) {
  const messages: Record<ProviderError['code'], string> = {
    INVALID_KEY: '图片服务鉴权失败',
    INSUFFICIENT_BALANCE: '图片服务余额不足',
    RATE_LIMIT: '图片服务请求频繁，请稍后重试',
    CONTENT_REJECTED: '内容未通过审核',
    PROVIDER_FORBIDDEN: '图片服务权限不足',
    INVALID_PARAMS: '图片参数不被支持',
    TIMEOUT: '图片提交超时',
    UPSTREAM_UNAVAILABLE: '图片服务连接失败',
    BAD_RESPONSE: '图片服务没有返回有效响应',
    UNKNOWN: '图片提交状态待确认',
  }
  return messages[code]
}

function submitFailurePatch(item: ImageJobItemRow, error: unknown): ItemPatch {
  if (!(error instanceof ProviderError)) {
    const described = describeError(error)
    // 只记异常名和消息。原始错误对象可能带上签名请求头。
    console.error(JSON.stringify({
      evt: 'image-job',
      stage: 'submit-failure',
      ordinal: item.ordinal,
      name: described.name,
      message: submitFailureMessage(described.message),
    }))
  }
  const failure = error instanceof ProviderError ? error : new ProviderError('UNKNOWN', '图片任务提交失败')
  const message = submitFailureMessage(failure.message)
  const definite = failure.requestSent === false || failure.holdPending || failure.definiteNotAccepted
  if (definite && (failure.retryable || failure.holdPending)) {
    return { status: 'pending',submission_state: 'not_sent',attempts: item.attempts + 1,
      error_code: failure.code,error_message: message }
  }
  if (definite) return { status: 'failed',submission_state: 'not_sent',attempts: item.attempts + 1,
    error_code: failure.code,error_message: message }
  // 没有任务编号不等于没有受理。网络中断和 504 停在 unknown，等回执或宽限，不再补 POST。
  return { status: 'pending',submission_state: 'unknown',attempts: item.attempts + 1,
    error_code: failure.code,error_message: message }
}

function isDefiniteGatewayRejection(error: ProviderError) {
  return error.definiteNotAccepted === true && error.retryable
    && (error.status === 502 || error.status === 503)
    && error.code === 'UPSTREAM_UNAVAILABLE'
}

function terminalGatewayRejection(error: ProviderError) {
  error.retryable = false
  error.definiteNotAccepted = true
  error.message = GATEWAY_REJECTED_MESSAGE
}

/** 无任务号的 unknown 过了宽限仍恢复不出受理证据时，用原错误收口并退预留，不再干等到生成截止。 */
export function staleUnknownPatch(item: ImageJobItemRow, job: ImageJobRow, now: number): ItemPatch | undefined {
  if (item.provider_task_id || item.result_object_key) return undefined
  if (item.submission_state !== 'unknown') return undefined
  if (!POLLABLE_ITEM_STATUSES.has(item.status)) return undefined
  const anchor = new Date(job.created_at).getTime()
  if (!Number.isFinite(anchor) || now - anchor < UNKNOWN_SUBMISSION_GRACE_MS) return undefined
  const message = item.error_message?.trim() || '图片提交状态未能确认，预留积分已退回'
  return {
    status: 'failed',
    error_code: item.error_code || 'UPSTREAM_UNAVAILABLE',
    error_message: message.includes('积分已退回') ? message : `${message}（积分已退回）`,
  }
}

export async function runProviderSubmits(
  bundle: ImageJobBundle,
  provider: ImageProvider,
  userId: string,
  runtime: ImageJobRuntime,
): Promise<SubmitOutcome[]> {
  const params = bundle.job.params as StoredImageParams
  const isTextToImage = bundle.job.capability === 'text_to_image'
  if (!isTextToImage && (!params.sourceImageKey || !isSafeObjectKey(userId, params.sourceImageKey))) {
    throw new HttpError(400, '原图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const referenceKey = isTextToImage ? '' : params.referenceImageKey?.trim() ?? ''
  if (referenceKey && referenceKey === params.sourceImageKey) {
    throw new HttpError(400, '商品图和场景图不能是同一张', 'INVALID_SOURCE')
  }
  if (referenceKey && !isSafeObjectKey(userId, referenceKey)) {
    throw new HttpError(400, '场景图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const sourceUrl = !isTextToImage && params.sourceImageKey ? await resolveInputUrl(params.sourceImageKey, runtime) : undefined
  const referenceUrl = referenceKey ? await resolveInputUrl(referenceKey, runtime) : undefined
  const prompt = submittedPrompt(bundle.job.provider_params, params)
  const parallel = imageJobPolicy(provider).maxParallel
  const images = sourceUrl ? [{ url: sourceUrl }, ...(referenceUrl ? [{ url: referenceUrl }] : [])] : []
  if (!runtime.execution || !bundle.job.lease_token) throw new ImageLeaseLost()
  const execution = runtime.execution
  const pending = bundle.items.filter(item => item.status === 'pending' && item.submission_state === 'not_sent'
    && !item.provider_task_id && !item.result_object_key)
  const batches = bundle.job.provider_params.batch === true ? (pending.length ? [pending] : []) : pending.map(item => [item])
  const results = await mapPool(batches.length, parallel, async index => {
    const group = batches[index]
    const minimumBudget = provider.capabilities(String(bundle.job.provider_params.model ?? '')).execution === 'sync-inline' ? 75_000 : 35_000
    if (runtime.allowSubmit === false || runtime.signal?.aborted
      || (runtime.budgetUntil !== undefined && runtime.budgetUntil - runtime.now() < minimumBudget)) return []
    const attemptId = randomUUID()
    const attempt = await execution.transaction(store => store.startSubmission(bundle.job.id,bundle.job.lease_token!,group.map(item => item.ordinal),attemptId))
    if (!attempt) return []
    let patches: SubmitOutcome[]
    let receipt: import('./types.js').AttemptReceipt
    try {
      if (runtime.signal?.aborted) {
        const error = new ProviderError('TIMEOUT','本轮提交预算已结束',true)
        error.requestSent = false
        throw error
      }
      if (!provider.submit) {
        const error = new ProviderError('INVALID_PARAMS','当前模型不支持提交',false,400)
        error.requestSent = false
        throw error
      }
      let gatewayRetries = 0
      let submitted: { providerTaskId: string } | undefined
      while (!submitted) {
        try {
          const result = await provider.submit({ model: String(bundle.job.provider_params.model ?? ''),prompt,images,
            providerParams: bundle.job.provider_params,ordinal: group[0].ordinal },providerContext(runtime,bundle.job,attemptId))
          if (!result.providerTaskId) throw new ProviderError('BAD_RESPONSE','图片服务没有返回任务编号')
          submitted = result
        } catch (error) {
          const failure = error instanceof ProviderError ? error : undefined
          const canRetry = !!failure && isDefiniteGatewayRejection(failure) && gatewayRetries < GATEWAY_REJECTION_RETRIES
            && !runtime.signal?.aborted
            && (runtime.budgetUntil === undefined || runtime.budgetUntil - runtime.now() >= minimumBudget)
          if (!canRetry) {
            // 重试耗尽或这次请求里没法再等。后台补提交在生产是关的，不能把 502 留到 5 分钟截止。
            if (failure && isDefiniteGatewayRejection(failure)) terminalGatewayRejection(failure)
            throw error
          }
          gatewayRetries += 1
          runtime.log({ stage: 'submit-gateway-retry', jobId: bundle.job.id, ordinal: group[0].ordinal, retry: gatewayRetries, status: failure.status })
          await runtime.sleep(retryBackoffMs(gatewayRetries - 1))
        }
      }
      receipt = { provider_task_id: submitted.providerTaskId,outcome: 'accepted',error_code: null,error_message: null,retryable: false }
      patches = group.map(item => ({ ordinal: item.ordinal,patch: { ...submittedPatch(item,submitted.providerTaskId),
        submission_state: 'accepted',submission_attempt_id: attemptId } }))
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError('UNKNOWN','图片任务提交失败')
      const definite = failure.requestSent === false || failure.holdPending || failure.definiteNotAccepted
      receipt = { provider_task_id: null,outcome: failure.requestSent === false ? 'not_sent' : definite ? 'rejected' : 'unknown',
        error_code: failure.code,error_message: submissionReceiptMessage(failure.code),retryable: !!definite && (failure.retryable || !!failure.holdPending) }
      patches = group.map(item => ({ ordinal: item.ordinal,patch: { ...submitFailurePatch(item,error),submission_attempt_id: attemptId } }))
    }
    // 即使租约失效，也允许记录这一次真实请求的回执，交给新持有者核对。
    await execution.transaction(store => store.recordSubmission(attemptId,receipt))
    return patches
  })
  return results.flat()
}

async function applyItemPatches(store: ImageJobStore, jobId: string, items: ImageJobItemRow[], outcomes: SubmitOutcome[]) {
  const next = [...items]
  for (const outcome of outcomes) {
    if (!outcome.patch || Object.keys(outcome.patch).length === 0) continue
    const current = next[outcome.ordinal]
    if (current.result_object_key) continue
    if (outcome.patch.submission_attempt_id && current.submission_attempt_id !== outcome.patch.submission_attempt_id) continue
    if (outcome.patch.result_object_key) {
      const attempts = await store.listAttempts(jobId)
      if (!attempts.some(attempt => attempt.kind === 'transfer' && attempt.ordinals.includes(outcome.ordinal)
        && attempt.object_key === outcome.patch.result_object_key && !attempt.cleanup_token && !attempt.cleaned_at)) continue
    }
    next[outcome.ordinal] = await store.updateItem(jobId, outcome.ordinal, outcome.patch)
  }
  return next
}

export async function failImageJobBeforeSubmit(store: ImageJobStore, bundle: ImageJobBundle, runtime: ImageJobRuntime, message: string) {
  if (!bundle.job.lease_token || !await store.assertLease(bundle.job.id,bundle.job.lease_token)) throw new ImageLeaseLost()
  const items: ImageJobItemRow[] = []
  for (const item of bundle.items) {
    items.push(await store.updateItem(bundle.job.id, item.ordinal, {
      status: 'failed', error_code: 'INPUT_UNAVAILABLE', error_message: message,
    }))
  }
  return finalizeJob(store, bundle.job, items, runtime, false)
}

function throttledWithoutUpstreamTask(items: ImageJobItemRow[]) {
  if (!items.length || items.some(item => item.provider_task_id || item.status === 'succeeded')) return false
  return items.some(item => item.error_code === 'RATE_LIMIT')
}

function deferredThrottlePollAt(job: ImageJobRow, items: ImageJobItemRow[], runtime: ImageJobRuntime) {
  const held = items.filter(item => item.status === 'pending' && !item.provider_task_id && item.error_code === 'RATE_LIMIT')
  if (!held.length) return undefined
  const attempts = Math.max(...held.map(item => item.attempts))
  const model = typeof job.provider_params.model === 'string' ? job.provider_params.model : job.model_profile_id
  const random = runtime.random ?? Math.random
  return new Date(runtime.now() + qwenThrottleBackoffMs(attempts, model, random))
}

export async function finalizeJob(
  store: ImageJobStore,
  job: ImageJobRow,
  items: ImageJobItemRow[],
  runtime: ImageJobRuntime,
  lateDelivery: boolean,
  outcomes: SubmitOutcome[] = [],
  options?: { keepScheduledPoll?: boolean; keepLease?: boolean },
) {
  if (job.capability !== 'text_to_video' && (!job.lease_token || !await store.assertLease(job.id,job.lease_token))) throw new ImageLeaseLost()
  const reduced = reduceJobStatus(items, runtime.now(), new Date(job.deadline_at).getTime())
  const throttledQueue = reduced.status === 'expired' && throttledWithoutUpstreamTask(items)
  const deferredPoll = deferredThrottlePollAt(job, items, runtime)
  const warnings = mergeWarnings(job.warnings, reduced.warnings, lateDelivery && reduced.status === 'succeeded' ? [LATE_RESULT_WARNING] : [])
  const terminal = reduced.status === 'succeeded' || reduced.status === 'failed' || reduced.status === 'expired'
  const succeeded = items.filter(item => item.status === 'succeeded').length
  let billingState = job.billing_state
  let creditsCharged = job.credits_charged
  if (terminal && job.billing_state === 'reserved') {
    if (reduced.status === 'succeeded' && !lateDelivery) {
      const unit = job.requested_count ? Math.round(job.credits_reserved / job.requested_count) : 0
      creditsCharged = succeeded * unit
      await runtime.billing.settle({ jobId: job.id, charged: creditsCharged })
      billingState = 'settled'
    } else {
      await runtime.billing.release(job.id)
      billingState = 'released'
      creditsCharged = 0
    }
    const persisted = await store.findById(job.id)
    if (!persisted) throw new Error('图片任务结算后丢失')
    if (persisted.billing_state !== 'reserved') {
      billingState = persisted.billing_state
      creditsCharged = persisted.credits_charged
    }
  }
  const providerParams = outcomes.some(outcome => outcome.vendor)
    ? mergeVendorUsage(job.provider_params, outcomes)
    : job.provider_params
  const scheduledPoll = deferredPoll ?? (options?.keepScheduledPoll
    ? job.next_poll_at : nextPollAt(runtime.now(), nextPollInterval(job, runtime)))
  // 短事务可能刚写入平台退避；收尾不得把已持久化的下次执行时间提前。
  const imagePoll = new Date(Math.max(new Date(scheduledPoll).getTime(),new Date(job.next_poll_at).getTime()))
  const next = await store.updateJob(job.id, {
    status: reduced.status,
    warnings,
    error_code: reduced.status === 'expired'
      ? (throttledQueue ? 'RATE_LIMIT' : 'TASK_TIMEOUT')
      : reduced.status === 'failed' ? (items.find(item => item.error_code)?.error_code ?? 'GENERATION_FAILED') : job.error_code,
    error_message: reduced.status === 'expired'
      ? (throttledQueue ? QWEN_THROTTLE_REFUND_MESSAGE : '任务处理超时，请重试')
      : reduced.status === 'failed'
        ? (items.find(item => item.error_message)?.error_message ?? (job.capability === 'text_to_video' ? '视频生成失败，请稍后重试' : '图片生成失败，请稍后重试'))
        : job.error_message,
    credits_charged: creditsCharged,
    billing_state: billingState,
    completed_at: terminal ? new Date(runtime.now()) : job.completed_at,
    ...(job.capability === 'text_to_video' && reduced.status === 'succeeded' && job.status !== 'succeeded'
      ? { expires_at: new Date(runtime.now() + VIDEO_RETENTION_MS), error_code: null, error_message: null } : {}),
    next_poll_at: (job.capability !== 'text_to_video' && new Date(job.deadline_at).getTime() <= runtime.now())
      ? new Date(runtime.now() + 300_000)
      : job.capability === 'text_to_video' ? scheduledPoll : imagePoll,
    ...(!options?.keepLease ? { lease_until: null,
      ...(job.capability !== 'text_to_video' ? { lease_token: null,lease_owner: null } : {}) } : {}),
    provider_params: providerParams,
  })
  return { job: next, items }
}

async function runBounded<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  if (!items.length) return
  let cursor = 0
  const slots = Math.min(Math.max(1, limit), items.length)
  await Promise.all(Array.from({ length: slots }, async () => {
    while (cursor < items.length) {
      const current = items[cursor]
      cursor += 1
      await worker(current)
    }
  }))
}

async function persistDownloadedResult(
  job: ImageJobRow,
  item: ImageJobItemRow,
  bytes: Uint8Array,
  mimeType: string,
  runtime: ImageJobRuntime,
) {
  if (!runtime.execution || !job.lease_token) throw new ImageLeaseLost()
  const params = job.params as StoredImageParams
  const source = sourceDimensions(params)
  const cropped = await runtime.crop(bytes, source.width, source.height)
  const attemptId = randomUUID()
  const objectKey = `generated/${job.user_id}/${job.scope}/${job.id}/${item.ordinal}/${attemptId}.${extensionFor(cropped.mimeType || mimeType)}`
  const descriptor = { object_key: objectKey,mime_type: cropped.mimeType || mimeType,width: cropped.width,height: cropped.height,
    checksum: createHash('sha256').update(cropped.bytes).digest('hex') }
  await runtime.execution.transaction(store => store.startTransfer(job.id,job.lease_token!,item.ordinal,attemptId,descriptor))
  await runtime.putObject(objectKey,cropped.bytes,descriptor.mime_type,runtime.signal)
  return {
    status: 'succeeded',
    result_object_key: objectKey,
    result_mime_type: cropped.mimeType || mimeType,
    result_width: cropped.width,
    result_height: cropped.height,
    error_code: null,
    error_message: null,
  } satisfies ItemPatch
}

function logProviderUsage(
  runtime: ImageJobRuntime,
  provider: ImageProvider,
  job: ImageJobRow,
  ordinal: number,
  vendor: ProviderVendorUsage | undefined,
) {
  if (!vendor) return
  const enableThinking = job.provider_params.enableThinking
  runtime.log({
    stage: `${provider.id}-usage`,
    jobId: job.id,
    ordinal,
    ...(typeof enableThinking === 'boolean' ? { enableThinking } : {}),
    ...vendor,
  })
}

function recordPollError(
  outcomes: SubmitOutcome[],
  runtime: ImageJobRuntime,
  job: ImageJobRow,
  item: ImageJobItemRow,
  error: unknown,
  overdue: boolean,
) {
  const failure = error instanceof ProviderError ? error : new ProviderError('UNKNOWN', '查询图片任务失败')
  runtime.log({ stage: 'advance-item', jobId: job.id, ordinal: item.ordinal, code: failure.code, message: failure.message })
  if (!failure.retryable && overdue) {
    outcomes.push({
      ordinal: item.ordinal,
      patch: { status: 'failed', error_code: failure.code, error_message: failure.message },
    })
  }
}

export async function collectAdvancePatches(
  job: ImageJobRow,
  items: ImageJobItemRow[],
  runtime: ImageJobRuntime,
): Promise<SubmitOutcome[]> {
  const provider = runtime.providerFor(job.provider)
  if (!provider?.getStatus || !provider.fetchResult) return []
  const now = runtime.now()
  const overdue = now >= new Date(job.deadline_at).getTime()
  const salvage = canSalvage(job, now, items)
  const ctx = providerContext(runtime, job)
  const outcomes: SubmitOutcome[] = []
  // 只重提还没有 task id 的明细。已送出的提交即使响应丢失也不再发，避免上游建两个任务。
  if (!overdue && provider.submit && items.some(item => item.status === 'pending' && item.submission_state === 'not_sent' && !item.provider_task_id && !item.result_object_key)) {
    outcomes.push(...await runProviderSubmits({ job, items }, provider, job.user_id, runtime))
  }
  const grouped = new Map<string, ImageJobItemRow[]>()
  for (const item of items) {
    if (item.result_object_key) continue
    const stale = staleUnknownPatch(item, job, now)
    if (stale) {
      outcomes.push({ ordinal: item.ordinal, patch: stale })
      continue
    }
    if (overdue && !item.provider_task_id && POLLABLE_ITEM_STATUSES.has(item.status)) {
      outcomes.push({ ordinal: item.ordinal, patch: { status: 'expired' } })
      continue
    }
    if (!item.provider_task_id) continue
    if (!POLLABLE_ITEM_STATUSES.has(item.status) && !(salvage && item.status === 'expired')) continue
    const list = grouped.get(item.provider_task_id) ?? []
    list.push(item)
    grouped.set(item.provider_task_id, list)
  }
  for (const [taskId, group] of grouped) {
    const shared = job.provider_params.batch === true || group.length > 1
    const lead = group.reduce((best, item) => item.ordinal < best.ordinal ? item : best)
    try {
      const state = await provider.getStatus(taskId, ctx)
      const batch = job.provider_params.batch === true
      const usageOrdinal = batch ? 0 : lead.ordinal
      const vendorFor = (item: ImageJobItemRow) => (batch || (shared && item.ordinal !== lead.ordinal) ? undefined : state.vendor)
      if (batch && state.state !== 'succeeded' && state.vendor) outcomes.push({ ordinal: usageOrdinal,patch: {},vendor: state.vendor })
      if (state.state === 'queued' || state.state === 'processing') {
        logProviderUsage(runtime, provider, job, usageOrdinal, state.vendor)
        for (const item of group) {
          outcomes.push({
            ordinal: item.ordinal,
            patch: { status: 'processing', progress: state.progress ?? item.progress },
            vendor: vendorFor(item),
          })
        }
        continue
      }
      if (state.state === 'failed') {
        logProviderUsage(runtime, provider, job, usageOrdinal, state.vendor)
        for (const item of group) {
          outcomes.push({
            ordinal: item.ordinal,
            patch: { status: 'failed', error_code: state.code, error_message: state.message },
            vendor: vendorFor(item),
          })
        }
        continue
      }
      if (state.state !== 'succeeded') continue
      const returned = batch ? state.resultUrls.slice(0,job.requested_count).filter(Boolean).length : shared
        ? group.filter(item => state.resultUrls[item.ordinal]).length
        : (state.resultUrls[0] ? 1 : 0)
      const vendor = applyCatalogVendorCost(job, state.vendor, returned)
      const vendorForPriced = (item: ImageJobItemRow) => (batch || (shared && item.ordinal !== lead.ordinal) ? undefined : vendor)
      if (batch && vendor) outcomes.push({ ordinal: usageOrdinal,patch: {},vendor })
      logProviderUsage(runtime,provider,job,usageOrdinal,vendor)
      if (!shared) {
        const resultUrl = state.resultUrls[0]
        if (!resultUrl) throw new ProviderError('BAD_RESPONSE', '图片服务没有返回结果地址')
        const downloaded = await provider.fetchResult(resultUrl, ctx)
        outcomes.push({
          ordinal: lead.ordinal,
          patch: await persistDownloadedResult(job, lead, downloaded.bytes, downloaded.mimeType, runtime),
          vendor,
        })
        continue
      }
      await runBounded(group, RESULT_DOWNLOAD_PARALLEL, async (item) => {
        const resultUrl = state.resultUrls[item.ordinal]
        if (!resultUrl) {
          outcomes.push({
            ordinal: item.ordinal,
            patch: { status: 'failed', error_code: 'BAD_RESPONSE', error_message: '图片服务返回的图片数量不足' },
            vendor: vendorForPriced(item),
          })
          return
        }
        try {
          const downloaded = await provider.fetchResult(resultUrl, ctx)
          outcomes.push({
            ordinal: item.ordinal,
            patch: await persistDownloadedResult(job, item, downloaded.bytes, downloaded.mimeType, runtime),
            vendor: vendorForPriced(item),
          })
        } catch (error) {
          recordPollError(outcomes, runtime, job, item, error, overdue)
        }
      })
    } catch (error) {
      for (const item of group) recordPollError(outcomes, runtime, job, item, error, overdue)
    }
  }
  return outcomes
}

/** 领取后重新读事实；缺少令牌时不能用 alreadyLeased 绕过写回保护。 */
export async function advanceJobInStore(
  store: ImageJobStore,
  bundle: ImageJobBundle,
  runtime: ImageJobRuntime,
  options?: { alreadyLeased?: boolean; outcomes?: SubmitOutcome[] },
) {
  let job = bundle.job
  if (!options?.alreadyLeased) {
    const now = runtime.now()
    if (!shouldAdvance(job,now,bundle.items) && now < new Date(job.deadline_at).getTime()) return bundle
    const leased = await store.tryAcquireLease(job.id,new Date(now + IMAGE_LEASE_MS))
    if (!leased) return bundle
    job = leased
  }
  const current = job.lease_token ? await store.assertLease(job.id,job.lease_token) : undefined
  if (!current) {
    runtime.log({ stage: 'fence-rejected',jobId: job.id })
    return { job: (await store.findById(job.id)) ?? job,items: await store.listItems(job.id) }
  }
  if (store.kind === 'sql' && !options?.outcomes) throw new Error('数据库事务内禁止执行图片网络操作')
  const outcomes = options?.outcomes ?? await collectAdvancePatches(current,await store.listItems(job.id),runtime)
  // 网络完成后再次核对；SQL 调用持有任务行锁直到事务提交。
  let fresh = await store.assertLease(job.id,job.lease_token!)
  if (!fresh) {
    runtime.log({ stage: 'fence-rejected',jobId: job.id })
    return { job: (await store.findById(job.id)) ?? job,items: await store.listItems(job.id) }
  }
  if (fresh.billing_state === 'reserved' && runtime.now() >= new Date(fresh.deadline_at).getTime()) {
    fresh = (await finalizeJob(store,fresh,await store.listItems(job.id),runtime,false,[],{ keepLease: true })).job
  }
  const items = await applyItemPatches(store,job.id,await store.listItems(job.id),outcomes)
  const late = fresh.billing_state !== 'reserved' || runtime.now() >= new Date(fresh.deadline_at).getTime()
  return finalizeJob(store,fresh,items,runtime,late,outcomes)
}

/** 回执与缓存恢复只有读取；无可靠发送协议的旧明细一律标为待确认。 */
async function reconcileImageAttempts(bundle: ImageJobBundle,runtime: ImageJobRuntime): Promise<ImageJobBundle> {
  if (!runtime.execution || !bundle.job.lease_token) throw new ImageLeaseLost()
  const attempts = await runtime.execution.transaction(store => store.listAttempts(bundle.job.id))
  const provider = runtime.providerFor(bundle.job.provider)
  const patches: SubmitOutcome[] = []
  for (const item of bundle.items) {
    if (item.result_object_key) continue
    const attempt = attempts.find(candidate => candidate.id === item.submission_attempt_id && candidate.kind === 'submit')
    if (!item.provider_task_id && (item.submission_state !== 'not_sent' || !item.submission_state)) {
      let receipt = attempt
      if (attempt && !attempt.provider_task_id && provider?.recoverSubmission) {
        const cached = await provider.recoverSubmission(item.ordinal,providerContext(runtime,bundle.job,attempt.id))
        if (cached) {
          await runtime.execution.transaction(store => store.recordSubmission(attempt.id,{ provider_task_id: cached.providerTaskId,
            outcome: 'accepted',error_code: null,error_message: null,retryable: false }))
          receipt = { ...attempt,provider_task_id: cached.providerTaskId,outcome: 'accepted' }
        }
      }
      if (receipt?.provider_task_id) patches.push({ ordinal: item.ordinal,patch: { provider_task_id: receipt.provider_task_id,
        submission_state: 'accepted',status: item.status === 'expired' ? 'expired' : 'submitted',error_code: null,error_message: null } })
      else if (receipt && (receipt.outcome === 'not_sent' || receipt.outcome === 'rejected')) {
        patches.push({ ordinal: item.ordinal,patch: { submission_state: 'not_sent',status: receipt.retryable ? item.status : 'failed',
          error_code: receipt.error_code,error_message: receipt.error_message } })
      } else patches.push({ ordinal: item.ordinal,patch: { submission_state: 'unknown' } })
    } else if (item.provider_task_id && item.submission_state !== 'accepted') {
      patches.push({ ordinal: item.ordinal,patch: { submission_state: 'accepted' } })
    }
    // 只认对象键、类型与校验和都相符的转存意图。缓存未命中不会再次生成。
    for (const transfer of attempts.filter(candidate => candidate.kind === 'transfer' && candidate.ordinals.includes(item.ordinal)).reverse()) {
      try {
        const object = await runtime.getObject(transfer.object_key!,runtime.signal)
        if (object.contentType?.split(';')[0] !== transfer.mime_type
          || createHash('sha256').update(object.bytes).digest('hex') !== transfer.checksum) continue
        patches.push({ ordinal: item.ordinal,patch: { status: 'succeeded',result_object_key: transfer.object_key,
          result_mime_type: transfer.mime_type,result_width: transfer.width,result_height: transfer.height,error_code: null,error_message: null } })
        break
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) continue
        throw error
      }
    }
  }
  return runtime.execution.transaction(async store => {
    const current = await store.assertLease(bundle.job.id,bundle.job.lease_token!)
    if (!current) throw new ImageLeaseLost()
    return { job: current,items: await applyItemPatches(store,current.id,await store.listItems(current.id),patches) }
  })
}

/** 所有入口共用：短事务准备 → 外部 I/O → 带令牌的短事务收尾。 */
export async function advanceImageClaim(bundle: ImageJobBundle,runtime: ImageJobRuntime,initial = false) {
  if (!runtime.execution || !bundle.job.lease_token) throw new ImageLeaseLost()
  const execution = runtime.execution
  const prepared = await execution.transaction(async (store,billing) => {
    const current = await store.assertLease(bundle.job.id,bundle.job.lease_token!)
    if (!current) throw new ImageLeaseLost()
    const items = await store.listItems(current.id)
    if (current.billing_state === 'reserved' && runtime.now() >= new Date(current.deadline_at).getTime()) {
      // 原截止时只按此前已经入库的成功张数结算，随后收取的结果不再收费。
      return finalizeJob(store,current,items,{ ...runtime,billing: runtime.billing === noopBilling ? billing : runtime.billing },false,[],{ keepLease: true })
    }
    return { job: current,items }
  })
  let outcomes: SubmitOutcome[] = []
  try {
    const reconciled = await reconcileImageAttempts(prepared,runtime)
    const provider = runtime.providerFor(reconciled.job.provider)
    if (initial && provider) {
      outcomes = await runProviderSubmits(reconciled,provider,reconciled.job.user_id,runtime)
      if (provider.capabilities(String(reconciled.job.provider_params.model ?? '')).execution === 'sync-inline') {
        const submitted = reconciled.items.map(item => ({ ...item,...outcomes.find(outcome => outcome.ordinal === item.ordinal)?.patch }))
        outcomes.push(...await collectAdvancePatches(reconciled.job,submitted,{ ...runtime,allowSubmit: false }))
      }
    } else outcomes = await collectAdvancePatches(reconciled.job,reconciled.items,runtime)
  } catch (error) {
    if (error instanceof ImageLeaseLost) {
      runtime.log({ stage: 'fence-rejected',jobId: bundle.job.id })
    } else if (initial && error instanceof HttpError && (error.status === 400 || error.status === 404)) {
      outcomes = prepared.items.filter(item => item.submission_state === 'not_sent').map(item => ({ ordinal: item.ordinal,
        patch: { status: 'failed',error_code: 'INPUT_UNAVAILABLE',error_message: '图片源文件读取失败' } }))
    } else runtime.log({ stage: 'advance-retry',jobId: bundle.job.id,code: 'IO_FAILED' })
  }
  return execution.transaction((store,billing) => advanceJobInStore(store,bundle,
    { ...runtime,billing: runtime.billing === noopBilling ? billing : runtime.billing },{ alreadyLeased: true,outcomes }))
}

export async function toClientImageTask(bundle: ImageJobBundle, runtime: ImageJobRuntime) {
  const mapped = toClientTaskStatus(bundle.job.status)
  const images = []
  for (const item of bundle.items) {
    if (!item.result_object_key || item.status !== 'succeeded') continue
    const signed = await runtime.signRead(item.result_object_key, 900)
    images.push({
      url: signed.url,
      expiresAt: signed.expiresAt,
      ordinal: item.ordinal,
      objectKey: item.result_object_key,
      width: item.result_width ?? 0,
      height: item.result_height ?? 0,
      mimeType: item.result_mime_type ?? 'image/png',
    })
  }
  const errorCode = bundle.job.error_code ?? mapped.errorCode
  const errorMessage = bundle.job.error_message ?? mapped.errorMessage
  return {
    id: bundle.job.id,
    requestId: bundle.job.request_id,
    capability: bundle.job.capability,
    status: mapped.status,
    params: bundle.job.params,
    modelProfileId: bundle.job.model_profile_id,
    resultUrls: images.map(image => image.url),
    resultImages: images,
    warnings: bundle.job.warnings,
    errorCode: mapped.status === 'failed' ? errorCode : undefined,
    errorMessage: mapped.status === 'failed' ? errorMessage : undefined,
    creditsCost: bundle.job.credits_charged,
    createdAt: iso(bundle.job.created_at),
    updatedAt: iso(bundle.job.updated_at),
  }
}

/** 提交阶段就已经把图片写入临时对象，需要在同一次请求里收进正式结果。 */
const SYNC_RESULT_PROVIDERS = new Set(['openrouter', 'ai-gateway'])

/**
 * 提交结果写回后结束这一轮。OpenRouter 与 AI Gateway 的图片在提交时已经生成并放入临时对象，
 * 这里接着下载到正式结果，避免等到初始轮询延迟。其他供应商仍只登记 task id。
 */
export async function finishSubmittedImageJob(
  store: ImageJobStore,
  bundle: ImageJobBundle,
  outcomes: SubmitOutcome[],
  runtime: ImageJobRuntime,
  provider: ImageProvider,
) {
  if (store.kind === 'sql') throw new Error('数据库事务内禁止同步结果转存')
  const current = bundle.job.lease_token ? await store.assertLease(bundle.job.id,bundle.job.lease_token) : undefined
  if (!current) throw new ImageLeaseLost()
  const items = await applyItemPatches(store,current.id,await store.listItems(current.id),outcomes)
  const collected = SYNC_RESULT_PROVIDERS.has(provider.id) ? await collectAdvancePatches(current,items,{ ...runtime,allowSubmit: false }) : []
  return advanceJobInStore(store,{ job: current,items },runtime,{ alreadyLeased: true,outcomes: [...outcomes,...collected] })
}

export async function submitImageTask(user: User, body: unknown, runtime = defaultImageJobRuntime()) {
  assertVariationSteerLimit(body)
  assertFusionRequest(body)
  assertRelightRequest(body)
  assertRetouchNoteLimit(body)
  const parsed = createImageTaskSchema.parse(body)
  const execution = sqlImageExecution(user.id,user.email)
  const bounded = boundedImageRuntime({ ...runtime,execution,allowSubmit: true },110_000)
  const created = await withIdentity(user.id,user.email,async sql => {
    await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
    await requireActive(sql,user.id)
    await sql`select pg_advisory_xact_lock(91517002)`
    const billingRuntime = { ...bounded,billing: runtime.billing === noopBilling ? createSqlBilling(sql) : runtime.billing }
    return createImageJobInStore(createSqlStore(sql,user.id),user,parsed,billingRuntime)
  })
  if (!created.created) return toClientImageTask(created.bundle,runtime)
  return toClientImageTask(await advanceImageClaim(created.bundle,bounded,true),runtime)
}

export async function loadImageTask(user: User,id: string,runtime = defaultImageJobRuntime()) {
  const prepared = await withIdentity(user.id,user.email,async sql => {
    await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
    await requireActive(sql,user.id)
    const store = createSqlStore(sql,user.id)
    await store.expireUserOverdue(new Date(runtime.now()))
    const job = await store.findById(id)
    if (!job) return null
    const items = await store.listItems(job.id)
    if (job.capability === 'text_to_video') return { mode: 'video' as const,job,items }
    if (!shouldAdvance(job,runtime.now(),items) || (!ACTIVE_JOB_STATUSES.has(job.status) && !canSalvage(job,runtime.now(),items)))
      return { mode: 'snapshot' as const,job,items }
    const leased = await store.tryAcquireLease(job.id,new Date(runtime.now() + IMAGE_LEASE_MS),'poll')
    return leased ? { mode: 'advance' as const,job: leased,items } : { mode: 'snapshot' as const,job,items }
  })
  if (!prepared) return null
  if (prepared.mode === 'video') {
    const { toClientVideoTask } = await import('../video-jobs/service.js')
    return toClientVideoTask(prepared)
  }
  if (prepared.mode === 'snapshot') return toClientImageTask(prepared,runtime)
  const bounded = boundedImageRuntime({ ...runtime,execution: sqlImageExecution(user.id,user.email),
    allowSubmit: process.env.IMAGE_BACKGROUND_SUBMIT_ENABLED === 'true' },110_000)
  return toClientImageTask(await advanceImageClaim(prepared,bounded),runtime)
}

export async function loadImageTaskByRequest(user: User, requestId: string, runtime = defaultImageJobRuntime()) {
  const found = await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const store = createSqlStore(sql, user.id)
    return store.findByRequestId(requestId)
  })
  if (!found) return null
  return loadImageTask(user, found.id, runtime)
}

export async function listImageTasks(user: User, page: number, capability?: ImageTaskCapability | 'text_to_video') {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const scope = runtimeScope()
    const [count] = await sql`select count(*)::integer as total from aigc.image_jobs
      where user_id=${user.id} and scope=${scope} and expires_at>now()
      and (${capability ?? null}::text is null or capability=${capability ?? null})`
    const rows = capability === 'text_to_video'
      ? await sql`select j.*,i.result_object_key,i.result_width,i.result_height,i.result_metadata,left(j.params->>'prompt',80) as preview
          from aigc.image_jobs j left join aigc.image_job_items i on i.job_id=j.id and i.ordinal=0
          where j.user_id=${user.id} and j.scope=${scope} and j.expires_at>now() and j.capability='text_to_video'
          order by j.created_at desc limit 20 offset ${(page - 1) * 20}`
      : await sql`select id,status,model_profile_id,capability,left(params->>'prompt',80) as preview,created_at,updated_at
          from aigc.image_jobs where user_id=${user.id} and scope=${scope} and expires_at>now()
          and (${capability ?? null}::text is null or capability=${capability ?? null})
          order by created_at desc limit 20 offset ${(page - 1) * 20}`
    return {
      items: rows.map(row => {
        const mapped = toClientTaskStatus(String(row.status))
        return {
          id: row.id,
          capability: row.capability,
          status: mapped.status,
          modelProfileId: row.model_profile_id,
          preview: row.preview,
          ...(capability === 'text_to_video' && row.status === 'succeeded' && row.result_object_key ? {
            video: { objectKey: row.result_object_key, ordinal: 0, width: row.result_width, height: row.result_height,
              mimeType: 'video/mp4', ...(row.result_metadata as object), retentionExpiresAt: iso(row.expires_at as Date | string) },
          } : {}),
          createdAt: iso(row.created_at as Date | string),
          updatedAt: iso(row.updated_at as Date | string),
        }
      }),
      total: count.total,
    }
  })
}

export async function peekImageTask(user: User, id: string) {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    return Boolean(await createSqlStore(sql, user.id).findById(id))
  })
}

export async function deleteImageTask(user: User, id: string) {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const scope = runtimeScope()
    const [job] = await sql`select status,capability from aigc.image_jobs
      where id=${id} and user_id=${user.id} and scope=${scope} and expires_at>now()`
    if (!job) return null
    if (job.capability === 'text_to_video') throw new HttpError(409, '请从资产列表移除视频，文件将在到期后自动清理', 'TASK_NOT_DELETABLE')
    if (job.status === 'queued' || job.status === 'processing') {
      throw new HttpError(409, '任务正在处理或不存在', 'TASK_NOT_DELETABLE')
    }
    await sql`delete from aigc.image_jobs where id=${id} and user_id=${user.id} and scope=${scope}`
    return { deleted: true }
  })
}
