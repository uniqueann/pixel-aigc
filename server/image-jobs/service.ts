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
import {
  VARIATION_USER_PROMPT_MAX,
  composeVariationPrompt,
  variationPromptLimitMessage,
} from '../../shared/variation.js'
import { configuredImageModels, imageProviderById } from '../image-providers/registry.js'
import { ProviderError, type ImageProvider, type ProviderContext } from '../image-providers/types.js'
import {
  DEFAULT_INITIAL_POLL_DELAY_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DRAGONCODE_MAX_DATA_URI_BYTES,
  SOURCE_PRESIGN_TTL_SECONDS,
  dragonCodeConfig,
} from '../image-providers/dragoncode/config.js'
import { describeReferenceUrl } from '../image-providers/dragoncode/images.js'
import { sleep as defaultSleep } from '../image-providers/http.js'
import { cropToSourceAspect } from './aspect-crop.js'
import { createSqlBilling, noopBilling, type BillingPort } from './billing.js'
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
import type { ImageJobBundle, ImageJobItemRow, ImageJobRow, ImageJobStore, InsertImageJobInput } from './types.js'

type User = Awaited<ReturnType<typeof authenticate>>

export const IMAGE_HOURLY_LIMIT = 20
export const IMAGE_USER_CONCURRENCY = 2
export const IMAGE_GLOBAL_CONCURRENCY = 20
export const IMAGE_LEASE_MS = 30_000
export const IMAGE_TASK_CAPABILITIES = new Set(['image_edit', 'variation'])

const uuid = z.uuid()
const imageSourceParams = {
  sourceImageKey: z.string().trim().min(1).max(512),
  sourceImageUrl: z.string().max(4000).optional(),
  count: z.number().int().min(1).max(4),
  resolution: z.enum(['1k', '2k', '4k']),
  size: z.object({
    width: z.number().int().positive().max(20000),
    height: z.number().int().positive().max(20000),
  }).optional(),
  sourceWidth: z.number().int().positive().max(20000).optional(),
  sourceHeight: z.number().int().positive().max(20000).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
}
const imageEditParams = z.object({
  ...imageSourceParams,
  prompt: z.string().trim().max(4000).optional(),
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
])

type ImageTaskCapability = 'image_edit' | 'variation'
type StoredImageParams = {
  prompt?: string
  sourceImageKey: string
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
  vendor?: { cost?: number; creditsCost?: number; expiresAt?: string | number }
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
  const label = operation === 'variation' ? '裂变' : '智能编辑'
  return new HttpError(503, `${label}尚未配置可用的图片模型`, operation === 'variation' ? 'VARIATION_UNAVAILABLE' : 'IMAGE_EDIT_UNAVAILABLE')
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
  if (parsed.capability === 'image_edit' && !isRetouch && !isFusion && !isRelight && userPrompt.length > (profile.ui.promptMaxLength ?? 4000)) {
    throw new HttpError(400, '编辑要求过长', 'INVALID_PARAMS')
  }
  if (isFusion && referenceKey === parsed.params.sourceImageKey) {
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
  if (!isSafeObjectKey(user.id, parsed.params.sourceImageKey)) {
    throw new HttpError(400, '原图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const dimensions = sourceDimensions(parsed.params)
  const normalized: NormalizedImageRequest = {
    operation: parsed.capability,
    prompt,
    images: [
      {
        source: { kind: 'r2', objectKey: parsed.params.sourceImageKey },
        width: dimensions.width,
        height: dimensions.height,
      },
      ...(isFusion ? [{ source: { kind: 'r2' as const, objectKey: referenceKey } }] : []),
    ],
    target: { size: parsed.params.size, resolution: parsed.params.resolution },
    count: parsed.params.count,
    extra: parsed.params.extra,
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
    if (existing.request_fingerprint !== fingerprint) {
      throw new HttpError(409, '请求标识已用于其他图片任务', 'REQUEST_CONFLICT')
    }
    return { bundle: { job: existing, items: await store.listItems(existing.id) }, created: false, provider }
  }
  if (await store.hourlyCount() >= IMAGE_HOURLY_LIMIT) {
    throw new HttpError(429, `每小时最多提交 ${IMAGE_HOURLY_LIMIT} 次图片任务，请稍后重试`, 'RATE_LIMIT')
  }
  if (await store.userActiveCount() >= IMAGE_USER_CONCURRENCY) {
    throw new HttpError(429, '当前已有图片任务正在处理，请等待完成', 'USER_CONCURRENCY')
  }
  if (await store.globalActiveCount() >= IMAGE_GLOBAL_CONCURRENCY) {
    throw new HttpError(429, '服务当前任务较多，请稍后重试', 'GLOBAL_CONCURRENCY')
  }
  const config = dragonCodeConfig()
  const timeoutMs = config?.taskTimeoutMs ?? 300_000
  const jobId = randomUUID()
  const effectiveResolution = mapped.providerParams.resolution as '1k' | '2k' | '4k'
  const unitPrice = profile.pricing.creditsPerImage[effectiveResolution]
  if (!Number.isSafeInteger(unitPrice) || !unitPrice || unitPrice <= 0) {
    throw new HttpError(503, '图片积分单价尚未配置', 'IMAGE_PRICE_UNAVAILABLE')
  }
  const reserved = mapped.fanOut * unitPrice
  const reservedOk = await runtime.billing.reserve({
    userId: user.id, jobId, amount: reserved,
    meta: { capability: parsed.capability, modelProfileId: profile.id, resolution: effectiveResolution, unitPrice },
  })
  if (!reservedOk.ok) throw new HttpError(402, reservedOk.message, reservedOk.code)
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
    nextPollAt: nextPollAt(
      runtime.now(),
      config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      true,
      config?.initialPollDelayMs ?? DEFAULT_INITIAL_POLL_DELAY_MS,
    ),
  }
  const job = await store.insertJob(input)
  const items = await store.insertItems(job, mapped.fanOut)
  return { bundle: { job, items }, created: true, provider }
}

export async function runProviderSubmits(
  bundle: ImageJobBundle,
  provider: ImageProvider,
  userId: string,
  runtime: ImageJobRuntime,
): Promise<SubmitOutcome[]> {
  const params = bundle.job.params as StoredImageParams
  if (!isSafeObjectKey(userId, params.sourceImageKey)) {
    throw new HttpError(400, '原图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const referenceKey = params.referenceImageKey?.trim() ?? ''
  if (referenceKey && referenceKey === params.sourceImageKey) {
    throw new HttpError(400, '商品图和场景图不能是同一张', 'INVALID_SOURCE')
  }
  if (referenceKey && !isSafeObjectKey(userId, referenceKey)) {
    throw new HttpError(400, '场景图对象无效或无权访问', 'INVALID_SOURCE')
  }
  const sourceUrl = await resolveInputUrl(params.sourceImageKey, runtime)
  const referenceUrl = referenceKey ? await resolveInputUrl(referenceKey, runtime) : undefined
  const prompt = submittedPrompt(bundle.job.provider_params, params)
  const parallel = dragonCodeConfig()?.maxParallel ?? 4
  const ctx = providerContext(runtime, bundle.job.request_id)
  return mapPool(bundle.items.length, parallel, async (index) => {
    const item = bundle.items[index]
    if (item.status !== 'pending') return { ordinal: item.ordinal, patch: {} }
    try {
      if (!provider.submit) throw new ProviderError('UNKNOWN', '当前模型不支持异步提交', false, 500)
      const submitted = await provider.submit({
        model: String(bundle.job.provider_params.model ?? ''),
        prompt,
        images: referenceUrl ? [{ url: sourceUrl }, { url: referenceUrl }] : [{ url: sourceUrl }],
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
        ? (items.find(item => item.error_message)?.error_message ?? '图片生成失败，请稍后重试')
        : job.error_message,
    credits_charged: creditsCharged,
    billing_state: billingState,
    completed_at: terminal ? new Date(runtime.now()) : job.completed_at,
    next_poll_at: nextPollAt(runtime.now(), dragonCodeConfig()?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS),
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
  for (const item of items) {
    if (item.result_object_key) continue
    if (overdue && !item.provider_task_id && POLLABLE_ITEM_STATUSES.has(item.status)) {
      outcomes.push({ ordinal: item.ordinal, patch: { status: 'expired' } })
      continue
    }
    if (!item.provider_task_id) continue
    if (!POLLABLE_ITEM_STATUSES.has(item.status) && !(salvage && item.status === 'expired')) continue
    try {
      const state = await provider.getStatus(item.provider_task_id, ctx)
      if (state.state === 'queued' || state.state === 'processing') {
        if (state.vendor) {
          runtime.log({ stage: 'dragoncode-usage', jobId: job.id, ordinal: item.ordinal, ...state.vendor })
        }
        outcomes.push({
          ordinal: item.ordinal,
          patch: { status: 'processing', progress: state.progress ?? item.progress },
          vendor: state.vendor,
        })
        continue
      }
      if (state.state === 'failed') {
        runtime.log({ stage: 'dragoncode-usage', jobId: job.id, ordinal: item.ordinal, ...state.vendor })
        outcomes.push({
          ordinal: item.ordinal,
          patch: { status: 'failed', error_code: state.code, error_message: state.message },
          vendor: state.vendor,
        })
        continue
      }
      if (state.state !== 'succeeded') continue
      const resultUrl = state.resultUrls[0]
      if (!resultUrl) throw new ProviderError('BAD_RESPONSE', '图片服务没有返回结果地址')
      runtime.log({ stage: 'dragoncode-usage', jobId: job.id, ordinal: item.ordinal, ...state.vendor })
      const downloaded = await provider.fetchResult(resultUrl, ctx)
      outcomes.push({
        ordinal: item.ordinal,
        patch: await persistDownloadedResult(job, item, downloaded.bytes, downloaded.mimeType, runtime),
        vendor: state.vendor,
      })
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError('UNKNOWN', '查询图片任务失败')
      runtime.log({ stage: 'advance-item', jobId: job.id, ordinal: item.ordinal, code: failure.code, message: failure.message })
      if (!failure.retryable && overdue) {
        outcomes.push({
          ordinal: item.ordinal,
          patch: { status: 'failed', error_code: failure.code, error_message: failure.message },
        })
      }
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
      const message = error instanceof ProviderError ? error.message : '图片源文件读取失败'
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

export async function listImageTasks(user: User, page: number) {
  return withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    const scope = runtimeScope()
    const [count] = await sql`select count(*)::integer as total from aigc.image_jobs
      where user_id=${user.id} and scope=${scope} and expires_at>now()`
    const rows = await sql`select id,status,model_profile_id,capability,left(params->>'prompt',80) as preview,created_at,updated_at
      from aigc.image_jobs where user_id=${user.id} and scope=${scope} and expires_at>now()
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
    const [job] = await sql`select status from aigc.image_jobs
      where id=${id} and user_id=${user.id} and scope=${scope} and expires_at>now()`
    if (!job) return null
    if (job.status === 'queued' || job.status === 'processing') {
      throw new HttpError(409, '任务正在处理或不存在', 'TASK_NOT_DELETABLE')
    }
    await sql`delete from aigc.image_jobs where id=${id} and user_id=${user.id} and scope=${scope}`
    return { deleted: true }
  })
}
