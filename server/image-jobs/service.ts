import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { authenticate } from '../auth.js'
import { runtimeScope, withIdentity } from '../db.js'
import { HttpError } from '../errors.js'
import { requireActive } from '../model-settings.js'
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
import { sleep as defaultSleep } from '../image-providers/http.js'
import { cropToSourceAspect } from './aspect-crop.js'
import { createSqlBilling, noopBilling, type BillingPort } from './billing.js'
import { reserveAndCreateJob } from './lifecycle.js'
import { VIDEO_RETENTION_MS } from '../../shared/video-models.js'
import { createSqlStore } from './repository.js'
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
export const IMAGE_LEASE_MS = 30_000
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
}).strict()

export const createImageTaskSchema = z.discriminatedUnion('capability', [
  z.object({
    capability: z.literal('image_edit'),
    requestId: uuid,
    params: imageEditParams,
    modelProfileId: z.string().optional(),
  }).strict(),
  z.object({
    capability: z.literal('variation'),
    requestId: uuid,
    params: variationParams,
    modelProfileId: z.string().optional(),
  }).strict(),
  z.object({
    capability: z.literal('text_to_image'),
    requestId: uuid,
    params: textToImageParams,
    modelProfileId: z.string().optional(),
  }).strict(),
])

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
  putObject: (key: string, bytes: Uint8Array, contentType: string) => Promise<void>
  getObject: (key: string) => Promise<{ bytes: Uint8Array; contentType?: string }>
  billing: BillingPort
  crop: typeof cropToSourceAspect
  providerFor: (id: string) => ImageProvider | undefined
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

export function mergeVendorUsage(
  providerParams: Record<string, unknown>,
  outcomes: SubmitOutcome[],
) {
  const previous = isRecord(providerParams.vendor) ? providerParams.vendor : {}
  const items = isRecord(previous.items) ? { ...previous.items } : {}
  for (const outcome of outcomes) {
    if (!outcome.vendor) continue
    items[String(outcome.ordinal)] = {
      cost: outcome.vendor.cost,
      credits_cost: outcome.vendor.creditsCost,
      expires_at: outcome.vendor.expiresAt,
      ...(outcome.vendor.outputWidth !== undefined ? { output_width: outcome.vendor.outputWidth } : {}),
      ...(outcome.vendor.outputHeight !== undefined ? { output_height: outcome.vendor.outputHeight } : {}),
      ...(outcome.vendor.outputImageCount !== undefined ? { output_image_count: outcome.vendor.outputImageCount } : {}),
      ...(outcome.vendor.outputImageType !== undefined ? { output_image_type: outcome.vendor.outputImageType } : {}),
    }
  }
  let cost = 0
  let creditsCost = 0
  for (const value of Object.values(items)) {
    if (!isRecord(value)) continue
    if (typeof value.cost === 'number') cost += value.cost
    if (typeof value.credits_cost === 'number') creditsCost += value.credits_cost
  }
  return {
    ...providerParams,
    vendor: { cost, credits_cost: creditsCost, items },
  }
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

function providerContext(runtime: ImageJobRuntime, requestId?: string): ProviderContext {
  return { fetch: runtime.fetch, sleep: runtime.sleep, now: runtime.now, log: runtime.log, requestId }
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
    const object = await runtime.getObject(objectKey)
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
  const prompt = parsed.capability === 'variation'
    ? composeVariationPrompt(userPrompt)
    : isFusion
      ? composeFusionPrompt(userPrompt)
      : isRelight
        ? composeRelightPrompt(relight, userPrompt)
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
            ...(userPrompt ? { prompt: userPrompt } : {}),
          }
        : parsed.params
  if ((isRetouch || isFusion || isRelight) && !userPrompt) delete storedParams.prompt
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
    extra: parsed.capability === 'text_to_image' ? undefined : parsed.params.extra,
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
  }
  const bundle = await reserveAndCreateJob(store, runtime.billing, user.id, input,
    { capability: parsed.capability, modelProfileId: profile.id, resolution: effectiveResolution, unitPrice })
  return { bundle, created: true, provider }
}

function nextPollInterval(job: ImageJobRow, runtime: ImageJobRuntime) {
  if (job.capability === 'text_to_video') return 60_000
  const provider = runtime.providerFor(job.provider)
  return provider ? imageJobPolicy(provider).pollIntervalMs : DEFAULT_IMAGE_JOB_POLICY.pollIntervalMs
}

/** 一次上游请求出 n 张。只提交一次，并把同一个 task id 写到所有尚未提交的明细。 */
async function submitBatch(
  bundle: ImageJobBundle,
  provider: ImageProvider,
  prompt: string,
  images: Array<{ url: string }>,
  ctx: ProviderContext,
): Promise<SubmitOutcome[]> {
  const pending = bundle.items.some(item => item.status === 'pending')
  if (!pending) return bundle.items.map(item => ({ ordinal: item.ordinal, patch: {} }))
  try {
    if (!provider.submit) throw new ProviderError('UNKNOWN', '当前模型不支持异步提交', false, 500)
    const submitted = await provider.submit({
      model: String(bundle.job.provider_params.model ?? ''),
      prompt,
      images,
      providerParams: bundle.job.provider_params,
    }, ctx)
    return bundle.items.map(item => item.status === 'pending'
      ? { ordinal: item.ordinal, patch: { status: 'submitted', provider_task_id: submitted.providerTaskId, attempts: item.attempts + 1 } }
      : { ordinal: item.ordinal, patch: {} })
  } catch (error) {
    const failure = error instanceof ProviderError ? error : new ProviderError('UNKNOWN', '图片任务提交失败')
    return bundle.items.map(item => item.status === 'pending'
      ? {
          ordinal: item.ordinal,
          patch: { status: 'failed', attempts: item.attempts + 1, error_code: failure.code, error_message: failure.message },
        }
      : { ordinal: item.ordinal, patch: {} })
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
  const ctx = providerContext(runtime, bundle.job.request_id)
  const images = sourceUrl ? [{ url: sourceUrl }, ...(referenceUrl ? [{ url: referenceUrl }] : [])] : []
  if (bundle.job.provider_params.batch === true) {
    return submitBatch(bundle, provider, prompt, images, ctx)
  }
  return mapPool(bundle.items.length, parallel, async (index) => {
    const item = bundle.items[index]
    if (item.status !== 'pending') return { ordinal: item.ordinal, patch: {} }
    try {
      if (!provider.submit) throw new ProviderError('UNKNOWN', '当前模型不支持异步提交', false, 500)
      const submitted = await provider.submit({
        model: String(bundle.job.provider_params.model ?? ''),
        prompt,
        images,
        providerParams: bundle.job.provider_params,
      }, ctx)
      return {
        ordinal: item.ordinal,
        patch: { status: 'submitted', provider_task_id: submitted.providerTaskId, attempts: item.attempts + 1 },
      }
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError('UNKNOWN', '图片任务提交失败')
      return {
        ordinal: item.ordinal,
        patch: {
          status: 'failed', attempts: item.attempts + 1,
          error_code: failure.code, error_message: failure.message,
        },
      }
    }
  })
}

async function applyItemPatches(store: ImageJobStore, jobId: string, items: ImageJobItemRow[], outcomes: SubmitOutcome[]) {
  const next = [...items]
  for (const outcome of outcomes) {
    if (!outcome.patch || Object.keys(outcome.patch).length === 0) continue
    next[outcome.ordinal] = await store.updateItem(jobId, outcome.ordinal, outcome.patch)
  }
  return next
}

export async function failImageJobBeforeSubmit(store: ImageJobStore, bundle: ImageJobBundle, runtime: ImageJobRuntime, message: string) {
  const items: ImageJobItemRow[] = []
  for (const item of bundle.items) {
    items.push(await store.updateItem(bundle.job.id, item.ordinal, {
      status: 'failed', error_code: 'INPUT_UNAVAILABLE', error_message: message,
    }))
  }
  return finalizeJob(store, bundle.job, items, runtime, false)
}

export async function finalizeJob(
  store: ImageJobStore,
  job: ImageJobRow,
  items: ImageJobItemRow[],
  runtime: ImageJobRuntime,
  lateDelivery: boolean,
  outcomes: SubmitOutcome[] = [],
) {
  const reduced = reduceJobStatus(items, runtime.now(), new Date(job.deadline_at).getTime())
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
  const next = await store.updateJob(job.id, {
    status: reduced.status,
    warnings,
    error_code: reduced.status === 'expired'
      ? 'TASK_TIMEOUT'
      : reduced.status === 'failed' ? (items.find(item => item.error_code)?.error_code ?? 'GENERATION_FAILED') : job.error_code,
    error_message: reduced.status === 'expired'
      ? '任务处理超时，请重试'
      : reduced.status === 'failed'
        ? (items.find(item => item.error_message)?.error_message ?? (job.capability === 'text_to_video' ? '视频生成失败，请稍后重试' : '图片生成失败，请稍后重试'))
        : job.error_message,
    credits_charged: creditsCharged,
    billing_state: billingState,
    completed_at: terminal ? new Date(runtime.now()) : job.completed_at,
    ...(job.capability === 'text_to_video' && reduced.status === 'succeeded' && job.status !== 'succeeded'
      ? { expires_at: new Date(runtime.now() + VIDEO_RETENTION_MS), error_code: null, error_message: null } : {}),
    next_poll_at: nextPollAt(runtime.now(), nextPollInterval(job, runtime)),
    lease_until: null,
    provider_params: providerParams,
  })
  return { job: next, items }
}

async function persistDownloadedResult(
  job: ImageJobRow,
  item: ImageJobItemRow,
  bytes: Uint8Array,
  mimeType: string,
  runtime: ImageJobRuntime,
) {
  const params = job.params as StoredImageParams
  const source = sourceDimensions(params)
  const cropped = await runtime.crop(bytes, source.width, source.height)
  const objectKey = `generated/${job.user_id}/${job.id}/${item.ordinal}.${extensionFor(cropped.mimeType || mimeType)}`
  await runtime.putObject(objectKey, cropped.bytes, cropped.mimeType || mimeType)
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
  runtime.log({ stage: `${provider.id}-usage`, jobId: job.id, ordinal, ...vendor })
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
  const ctx = providerContext(runtime, job.request_id)
  const outcomes: SubmitOutcome[] = []
  const grouped = new Map<string, ImageJobItemRow[]>()
  for (const item of items) {
    if (item.result_object_key) continue
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
    const shared = group.length > 1
    const lead = group.reduce((best, item) => item.ordinal < best.ordinal ? item : best)
    try {
      const state = await provider.getStatus(taskId, ctx)
      const vendorFor = (item: ImageJobItemRow) => (shared && item.ordinal !== lead.ordinal ? undefined : state.vendor)
      if (state.state === 'queued' || state.state === 'processing') {
        logProviderUsage(runtime, provider, job, lead.ordinal, state.vendor)
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
        logProviderUsage(runtime, provider, job, lead.ordinal, state.vendor)
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
      if (!shared) {
        const resultUrl = state.resultUrls[0]
        if (!resultUrl) throw new ProviderError('BAD_RESPONSE', '图片服务没有返回结果地址')
        logProviderUsage(runtime, provider, job, lead.ordinal, state.vendor)
        const downloaded = await provider.fetchResult(resultUrl, ctx)
        outcomes.push({
          ordinal: lead.ordinal,
          patch: await persistDownloadedResult(job, lead, downloaded.bytes, downloaded.mimeType, runtime),
          vendor: state.vendor,
        })
        continue
      }
      logProviderUsage(runtime, provider, job, lead.ordinal, state.vendor)
      for (const item of group) {
        const resultUrl = state.resultUrls[item.ordinal]
        if (!resultUrl) {
          outcomes.push({
            ordinal: item.ordinal,
            patch: { status: 'failed', error_code: 'BAD_RESPONSE', error_message: '图片服务返回的图片数量不足' },
            vendor: vendorFor(item),
          })
          continue
        }
        try {
          const downloaded = await provider.fetchResult(resultUrl, ctx)
          outcomes.push({
            ordinal: item.ordinal,
            patch: await persistDownloadedResult(job, item, downloaded.bytes, downloaded.mimeType, runtime),
            vendor: vendorFor(item),
          })
        } catch (error) {
          recordPollError(outcomes, runtime, job, item, error, overdue)
        }
      }
    } catch (error) {
      for (const item of group) recordPollError(outcomes, runtime, job, item, error, overdue)
    }
  }
  return outcomes
}

export async function advanceJobInStore(
  store: ImageJobStore,
  bundle: ImageJobBundle,
  runtime: ImageJobRuntime,
  options?: { alreadyLeased?: boolean; outcomes?: SubmitOutcome[] },
) {
  const now = runtime.now()
  const overdue = now >= new Date(bundle.job.deadline_at).getTime()
  const salvage = canSalvage(bundle.job, now, bundle.items)
  if (!ACTIVE_JOB_STATUSES.has(bundle.job.status) && !salvage) return bundle
  let job = bundle.job
  if (!options?.alreadyLeased) {
    if (!shouldAdvance(job, now) && !overdue && !salvage) return bundle
    const leased = await store.tryAcquireLease(job.id, new Date(now + IMAGE_LEASE_MS))
    if (!leased) return bundle
    job = leased
  }
  const outcomes = options?.outcomes ?? await collectAdvancePatches(job, bundle.items, runtime)
  const items = await applyItemPatches(store, job.id, bundle.items, outcomes)
  const late = overdue || job.status === 'expired'
  return finalizeJob(store, job, items, runtime, late && items.some(item => item.status === 'succeeded'), outcomes)
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

export async function submitImageTask(user: User, body: unknown, runtime = defaultImageJobRuntime()) {
  assertVariationSteerLimit(body)
  assertFusionRequest(body)
  assertRelightRequest(body)
  assertRetouchNoteLimit(body)
  const parsed = createImageTaskSchema.parse(body)
  const created = await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    await sql`select pg_advisory_xact_lock(91517002)`
    const billingRuntime = runtime.billing === noopBilling ? { ...runtime, billing: createSqlBilling(sql) } : runtime
    return createImageJobInStore(createSqlStore(sql, user.id), user, parsed, billingRuntime)
  })
  if (!created.created) return toClientImageTask(created.bundle, runtime)
  let outcomes: SubmitOutcome[]
  try {
    outcomes = await runProviderSubmits(created.bundle, created.provider, user.id, runtime)
  } catch (error) {
    runtime.log({ stage: 'submit-input', jobId: created.bundle.job.id, message: error instanceof Error ? error.message : String(error) })
    return withIdentity(user.id, user.email, async sql => {
      await requireActive(sql, user.id)
      const store = createSqlStore(sql, user.id)
      const message = error instanceof ProviderError ? error.message
        : created.bundle.job.capability === 'text_to_image' ? '文生图任务提交失败' : '图片源文件读取失败'
      const billingRuntime = runtime.billing === noopBilling ? { ...runtime, billing: createSqlBilling(sql) } : runtime
      const finalized = await failImageJobBeforeSubmit(store, created.bundle, billingRuntime, message)
      return toClientImageTask(finalized, runtime)
    })
  }
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const store = createSqlStore(sql, user.id)
    const items = await applyItemPatches(store, created.bundle.job.id, created.bundle.items, outcomes)
    const billingRuntime = runtime.billing === noopBilling ? { ...runtime, billing: createSqlBilling(sql) } : runtime
    const finalized = await finalizeJob(store, created.bundle.job, items, billingRuntime, false, outcomes)
    return toClientImageTask(finalized, runtime)
  })
}

export async function loadImageTask(user: User, id: string, runtime = defaultImageJobRuntime()) {
  const prepared = await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const store = createSqlStore(sql, user.id)
    await store.expireUserOverdue(new Date(runtime.now()))
    const job = await store.findById(id)
    if (!job) return null
    const items = await store.listItems(job.id)
    if (job.capability === 'text_to_video') return { mode: 'video' as const, job, items }
    const now = runtime.now()
    const overdue = now >= new Date(job.deadline_at).getTime()
    const salvage = canSalvage(job, now, items)
    if ((!ACTIVE_JOB_STATUSES.has(job.status) && !salvage) || (!shouldAdvance(job, now) && !overdue && !salvage)) {
      return { mode: 'snapshot' as const, job, items }
    }
    const leased = await store.tryAcquireLease(job.id, new Date(now + IMAGE_LEASE_MS))
    if (!leased) return { mode: 'snapshot' as const, job, items }
    return { mode: 'advance' as const, job: leased, items }
  })
  if (!prepared) return null
  if (prepared.mode === 'video') {
    const { toClientVideoTask } = await import('../video-jobs/service.js')
    return toClientVideoTask(prepared)
  }
  if (prepared.mode === 'snapshot') return toClientImageTask(prepared, runtime)
  const outcomes = await collectAdvancePatches(prepared.job, prepared.items, runtime)
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const store = createSqlStore(sql, user.id)
    const billingRuntime = runtime.billing === noopBilling ? { ...runtime, billing: createSqlBilling(sql) } : runtime
    const advanced = await advanceJobInStore(store, prepared, billingRuntime, { alreadyLeased: true, outcomes })
    return toClientImageTask(advanced, runtime)
  })
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
