import { createHash, randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { z } from 'zod'
import { VIDEO_PROMPT_MAX } from '../../shared/prompt-limits.js'
import { SEEDANCE_VIDEO_MODEL, VIDEO_RATIOS, type VideoResult } from '../../shared/video-models.js'
import type { authenticate } from '../auth.js'
import { runtimeScope, withIdentity } from '../db.js'
import { HttpError } from '../errors.js'
import { requireActive } from '../members.js'
import { getObjectLimited, putObject } from '../storage.js'
import { noopBilling, createSqlBilling } from '../image-jobs/billing.js'
import { reserveAndCreateJob } from '../image-jobs/lifecycle.js'
import { createSqlStore } from '../image-jobs/repository.js'
import { defaultImageJobRuntime, finalizeJob, isSafeObjectKey, type ImageJobRuntime } from '../image-jobs/service.js'
import type { ImageJobBundle, ImageJobStore, ImageJobItemRow } from '../image-jobs/types.js'
import { seedanceProvider } from '../video-providers/seedance/index.js'
import { videoCallbackUrl, videoGenerationAvailable } from '../video-providers/seedance/config.js'
import { probeVideo } from '../video-providers/metadata.js'
import { VideoProviderError, type VideoProvider } from '../video-providers/types.js'

type User = Awaited<ReturnType<typeof authenticate>>
export const VIDEO_DEADLINE_MS = 75 * 60 * 1000
export const VIDEO_TRANSFER_WINDOW_MS = 15 * 60 * 1000
export const VIDEO_USER_CONCURRENCY = 1
export const VIDEO_HOURLY_LIMIT = 6
export const VIDEO_GLOBAL_CONCURRENCY = 5

const common = {
  prompt: z.string().trim().min(1, '请填写视频描述').max(VIDEO_PROMPT_MAX, `视频描述不能超过 ${VIDEO_PROMPT_MAX} 字`),
  size: z.object({ width: z.number().int().positive().max(20000), height: z.number().int().positive().max(20000) }).strict(),
  count: z.literal(1), durationSeconds: z.union([z.literal(5), z.literal(10)]),
  resolution: z.literal('720p'), generateAudio: z.boolean().default(false),
}
export const createVideoTaskSchema = z.object({
  capability: z.literal('text_to_video'), requestId: z.uuid(),
  modelProfileId: z.literal(SEEDANCE_VIDEO_MODEL.id).default(SEEDANCE_VIDEO_MODEL.id),
  priceVersion: z.string().min(1),
  params: z.discriminatedUnion('mode', [
    z.object({ ...common, mode: z.literal('text_to_video'), ratio: z.enum(VIDEO_RATIOS) }).strict(),
    z.object({ ...common, mode: z.literal('image_to_video'), ratio: z.literal('adaptive'),
      sourceImageKey: z.string().min(1).max(512), sourceImageUrl: z.string().max(4000).optional() }).strict(),
  ]),
}).strict()
type VideoRequest = z.infer<typeof createVideoTaskSchema>

export interface VideoJobRuntime extends ImageJobRuntime {
  videoProvider: VideoProvider
  readSource: typeof getObjectLimited
  writeVideo: typeof putObject
  probe: typeof probeVideo
  callbackUrl: (jobId: string, scope: string) => string
}

export function defaultVideoJobRuntime(): VideoJobRuntime {
  return { ...defaultImageJobRuntime(), videoProvider: seedanceProvider, readSource: getObjectLimited,
    writeVideo: putObject, probe: probeVideo, callbackUrl: videoCallbackUrl }
}

export function videoFingerprint(parsed: VideoRequest) {
  // 临时签名地址会变化，幂等只使用持久的对象标识和生成参数。
  const params = { ...parsed.params }
  if ('sourceImageUrl' in params) delete params.sourceImageUrl
  return createHash('sha256').update(JSON.stringify({ params, modelProfileId: parsed.modelProfileId, priceVersion: parsed.priceVersion })).digest('hex')
}

async function existingVideo(store: ImageJobStore, parsed: VideoRequest) {
  const job = await store.findByRequestId(parsed.requestId)
  if (!job) return undefined
  if (job.capability !== 'text_to_video' || job.request_fingerprint !== videoFingerprint(parsed)) {
    throw new HttpError(409, '请求标识已用于其他任务', 'REQUEST_CONFLICT')
  }
  return { job, items: await store.listItems(job.id) }
}

export async function prepareVideoSource(userId: string, parsed: VideoRequest, runtime: VideoJobRuntime) {
  if (parsed.params.mode === 'text_to_video') return undefined
  const key = parsed.params.sourceImageKey
  if (!isSafeObjectKey(userId, key) || key.includes('/video/')) throw new HttpError(400, '原图对象无效或无权访问', 'INVALID_SOURCE')
  const object = await runtime.readSource(key, 20 * 1024 * 1024, AbortSignal.timeout(20_000))
  const metadata = await sharp(object.bytes, { limitInputPixels: 40_000_000 }).metadata().catch(() => undefined)
  const width = metadata?.width ?? 0, height = metadata?.height ?? 0
  if (!metadata || !['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1
    || width < 300 || height < 300 || width > 6000 || height > 6000 || width / height < .4 || width / height > 2.5) {
    throw new HttpError(400, '请使用静态 JPEG、PNG 或 WebP 图片，每边 300–6000 像素，宽高比在 0.4–2.5 之间', 'VIDEO_IMAGE_NOT_SUPPORTED')
  }
  return (await runtime.signRead(key, 7200)).url
}

export async function createVideoJobInStore(store: ImageJobStore, user: Pick<User, 'id'>, parsed: VideoRequest, runtime: VideoJobRuntime) {
  const existing = await existingVideo(store, parsed)
  if (existing) return { bundle: existing, created: false }
  if (parsed.priceVersion !== SEEDANCE_VIDEO_MODEL.pricing.version) throw new HttpError(409, '视频价格已更新，请刷新配置后重试', 'VIDEO_PRICE_CHANGED')
  await store.expireUserOverdue(new Date(runtime.now()))
  if (await store.hourlyCount() >= VIDEO_HOURLY_LIMIT) throw new HttpError(429, '每小时最多创建 6 个视频任务，请稍后重试', 'RATE_LIMIT')
  if (await store.userActiveCount() >= VIDEO_USER_CONCURRENCY) throw new HttpError(429, '已有视频正在生成，请完成后再试', 'USER_CONCURRENCY')
  if (await store.globalActiveCount() >= VIDEO_GLOBAL_CONCURRENCY) throw new HttpError(429, '视频服务当前任务较多，请稍后重试', 'GLOBAL_CONCURRENCY')
  const params = { ...parsed.params }
  if ('sourceImageUrl' in params) delete params.sourceImageUrl
  const amount = SEEDANCE_VIDEO_MODEL.pricing.creditsPerVideo[params.durationSeconds]
  const bundle = await reserveAndCreateJob(store, runtime.billing, user.id, {
    id: randomUUID(), requestId: parsed.requestId, fingerprint: videoFingerprint(parsed),
    capability: 'text_to_video', modelProfileId: parsed.modelProfileId, provider: 'seedance',
    params, providerParams: { model: SEEDANCE_VIDEO_MODEL.model, priceVersion: parsed.priceVersion,
      unitPrice: amount, phase: 'submitting' }, requestedCount: 1, warnings: [],
    creditsReserved: amount, billingState: 'reserved', deadlineAt: new Date(runtime.now() + VIDEO_DEADLINE_MS),
    nextPollAt: new Date(runtime.now() + 60_000),
  }, { capability: 'text_to_video', modelProfileId: parsed.modelProfileId, durationSeconds: params.durationSeconds,
    resolution: params.resolution, generateAudio: params.generateAudio, priceVersion: parsed.priceVersion, unitPrice: amount })
  // 提交意图先落盘；进程中断后也不会再次创建上游任务。
  bundle.items[0] = await store.updateItem(bundle.job.id, 0, { status: 'submitted', attempts: 1 })
  return { bundle, created: true }
}

export function videoResultReference(bundle: ImageJobBundle): Omit<VideoResult, 'url' | 'expiresAt'> | undefined {
  const item = bundle.items[0]
  if (!item?.result_object_key || item.status !== 'succeeded') return undefined
  const meta = item.result_metadata ?? {}
  return { objectKey: item.result_object_key, ordinal: 0, width: item.result_width ?? 0, height: item.result_height ?? 0,
    mimeType: 'video/mp4', durationSeconds: Number(meta.durationSeconds), sizeBytes: Number(meta.sizeBytes),
    hasAudio: meta.hasAudio === true, posterKey: typeof meta.posterKey === 'string' ? meta.posterKey : undefined,
    retentionExpiresAt: new Date(bundle.job.expires_at).toISOString() }
}

export async function toClientVideoTask(bundle: ImageJobBundle, runtime: VideoJobRuntime = defaultVideoJobRuntime()) {
  const reference = videoResultReference(bundle)
  const ttl = Math.min(900, Math.floor((new Date(bundle.job.expires_at).getTime() - runtime.now()) / 1000))
  const videos: VideoResult[] = reference && ttl > 0
    ? [{ ...reference, ...await runtime.signRead(reference.objectKey, ttl) }] : []
  const failed = ['failed', 'expired'].includes(bundle.job.status)
  const errorMessage = failed ? bundle.job.error_message : undefined
  const refundedMessage = failed && bundle.job.billing_state === 'released' && bundle.job.credits_reserved > 0
    ? `${(errorMessage ?? '视频生成失败').replace('积分将退回', '积分已退回')}；本次预扣积分已退回` : errorMessage
  return {
    id: bundle.job.id, capability: 'text_to_video', status: bundle.job.status === 'expired' ? 'failed' : bundle.job.status,
    phase: ['queued', 'processing'].includes(bundle.job.status) ? bundle.job.provider_params.phase : undefined,
    params: bundle.job.params, modelProfileId: bundle.job.model_profile_id, resultVideos: videos,
    resultUrls: videos.map(video => video.url), warnings: bundle.job.warnings,
    errorCode: ['failed', 'expired'].includes(bundle.job.status) ? bundle.job.error_code : undefined,
    errorMessage: refundedMessage,
    creditsCost: bundle.job.credits_charged, retentionExpiresAt: new Date(bundle.job.expires_at).toISOString(),
    createdAt: new Date(bundle.job.created_at).toISOString(), updatedAt: new Date(bundle.job.updated_at).toISOString(),
  }
}

/** 提交返回与回调共享行锁；补齐标识时保留正在转存的租约和阶段。 */
export async function applyVideoSubmission(
  store: ImageJobStore, jobId: string, runtime: VideoJobRuntime,
  providerTaskId?: string, failure?: VideoProviderError,
) {
  const job = await store.findById(jobId)
  if (!job) throw new HttpError(404, '视频任务不存在', 'TASK_NOT_FOUND')
  const items = await store.listItems(job.id)
  if (providerTaskId) {
    const candidate = items[0].provider_task_id ?? job.provider_params.callbackTaskId
    if (candidate && candidate !== providerTaskId) throw new HttpError(409, '视频任务标识冲突', 'REQUEST_CONFLICT')
    items[0] = await store.updateItem(job.id, 0, { provider_task_id: providerTaskId })
  }
  if (['succeeded', 'failed', 'expired'].includes(job.status)) return { job, items }
  if (failure && !failure.ambiguous && !items[0].provider_task_id && !job.provider_params.callbackTaskId) {
    items[0] = await store.updateItem(job.id, 0, { status: 'failed', error_code: failure.code, error_message: failure.message })
    return finalizeJob(store, job, items, runtime, false)
  }
  const phase = job.provider_params.phase === 'submitting' && providerTaskId ? 'queued' : job.provider_params.phase
  const next = await store.updateJob(job.id, { provider_params: { ...job.provider_params, phase }, next_poll_at: new Date(runtime.now()) })
  return { job: next, items }
}

export async function submitVideoTask(user: User, body: unknown, runtime = defaultVideoJobRuntime()) {
  const parsed = createVideoTaskSchema.parse(body)
  const existing = await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    return existingVideo(createSqlStore(sql, user.id, 'video'), parsed)
  })
  if (existing) return toClientVideoTask(existing, runtime)
  if (!videoGenerationAvailable()) throw new HttpError(503, '视频生成尚未开放或配置不完整', 'VIDEO_UNAVAILABLE')
  if (parsed.priceVersion !== SEEDANCE_VIDEO_MODEL.pricing.version) throw new HttpError(409, '视频价格已更新，请刷新配置后重试', 'VIDEO_PRICE_CHANGED')
  const sourceImageUrl = await prepareVideoSource(user.id, parsed, runtime)
  const created = await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    await sql`select pg_advisory_xact_lock(91517003)`
    return createVideoJobInStore(createSqlStore(sql, user.id, 'video'), user, parsed,
      { ...runtime, billing: runtime.billing === noopBilling ? createSqlBilling(sql) : runtime.billing })
  })
  if (!created.created) return toClientVideoTask(created.bundle, runtime)
  let providerTaskId: string | undefined
  let failure: VideoProviderError | undefined
  try {
    const result = await runtime.videoProvider.submit({ model: SEEDANCE_VIDEO_MODEL.model, ...parsed.params, sourceImageUrl,
      callbackUrl: runtime.callbackUrl(created.bundle.job.id, runtimeScope()) },
    { fetch: runtime.fetch, now: runtime.now, sleep: runtime.sleep, log: runtime.log, requestId: parsed.requestId })
    providerTaskId = result.providerTaskId
  } catch (error) {
    failure = error instanceof VideoProviderError ? error : new VideoProviderError('UPSTREAM_UNAVAILABLE', '正在确认视频任务状态', true, true)
  }
  const bundle = await withIdentity(user.id, user.email, async sql => {
    const store = createSqlStore(sql, user.id, 'video')
    await sql`select id from aigc.image_jobs where id=${created.bundle.job.id} for update`
    return applyVideoSubmission(store, created.bundle.job.id,
      { ...runtime, billing: runtime.billing === noopBilling ? createSqlBilling(sql) : runtime.billing }, providerTaskId, failure)
  })
  runtime.log({ stage: 'video-submit', jobId: bundle.job.id, code: failure?.code, confirmed: !!providerTaskId })
  return toClientVideoTask(bundle, runtime)
}

export async function collectVideoOutcome(
  bundle: ImageJobBundle, runtime: VideoJobRuntime,
  beforeTransfer: (providerParams: Record<string, unknown>) => Promise<void> = async () => {},
) {
  const job = bundle.job, item = bundle.items[0]
  let providerParams = { ...job.provider_params }
  let patch: Partial<ImageJobItemRow> = {}
  const overdue = runtime.now() >= new Date(job.deadline_at).getTime()
  if (overdue && job.status !== 'expired') return { providerParams, patch: { status: 'expired' } as Partial<ImageJobItemRow> }
  const id = item.provider_task_id ?? (typeof providerParams.callbackTaskId === 'string' ? providerParams.callbackTaskId : undefined)
  if (!id) return { providerParams, patch }
  const signal = AbortSignal.timeout(overdue ? 100_000 : Math.max(1, Math.min(100_000, new Date(job.deadline_at).getTime() - runtime.now())))
  const ctx = { fetch: runtime.fetch, now: runtime.now, sleep: runtime.sleep, log: runtime.log, signal, requestId: job.request_id }
  try {
    const state = await runtime.videoProvider.getStatus(id, ctx)
    if (state.model !== job.provider_params.model) throw new VideoProviderError('BAD_RESPONSE', '供应商视频模型与任务不匹配')
    patch.provider_task_id = id
    providerParams.vendor = state.usage ?? providerParams.vendor
    if (state.state === 'failed') return { providerParams, patch: { ...patch, status: 'failed', error_code: state.code, error_message: state.message } }
    if (state.state !== 'succeeded') {
      providerParams.phase = state.state === 'queued' ? 'queued' : 'generating'
      return { providerParams, patch: { ...patch, status: overdue ? 'expired' : 'processing' } }
    }
    const startedAt = Number(providerParams.transferStartedAt ?? runtime.now())
    if (runtime.now() - startedAt >= VIDEO_TRANSFER_WINDOW_MS) throw new VideoProviderError('VIDEO_RESULT_TIMEOUT', '视频保存超时，积分将退回')
    providerParams = { ...providerParams, phase: 'transferring', transferStartedAt: startedAt,
      transferAttempts: Number(providerParams.transferAttempts ?? 0) + 1 }
    await beforeTransfer(providerParams)
    const started = runtime.now()
    const bytes = await runtime.videoProvider.fetchResult(state.videoUrl, ctx)
    runtime.log({ stage: 'video-download', jobId: job.id, ms: runtime.now() - started, bytes: bytes.byteLength })
    const probeStarted = runtime.now()
    const measured = runtime.probe(bytes)
    runtime.log({ stage: 'video-probe', jobId: job.id, ms: runtime.now() - probeStarted })
    if (measured.hasAudio !== (job.params.generateAudio === true)) throw new VideoProviderError('VIDEO_RESULT_INVALID', '视频声音与所选配置不匹配，积分将退回')
    const objectKey = `generated/${job.user_id}/video/${job.id}/0.mp4`
    const writeStarted = runtime.now()
    await runtime.writeVideo(objectKey, bytes, 'video/mp4', signal)
    runtime.log({ stage: 'video-upload', jobId: job.id, ms: runtime.now() - writeStarted, bytes: bytes.byteLength })
    let posterKey: string | undefined
    if (state.posterUrl && !signal.aborted) {
      try {
        const poster = await runtime.videoProvider.fetchResult(state.posterUrl, ctx, 10 * 1024 * 1024)
        const thumbnail = await sharp(poster, { limitInputPixels: 40_000_000 }).resize(320, 320, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
        posterKey = `generated/${job.user_id}/video/${job.id}/poster.jpg`
        await runtime.writeVideo(posterKey, thumbnail, 'image/jpeg', signal)
      } catch { runtime.log({ stage: 'video-poster', jobId: job.id, code: 'POSTER_UNAVAILABLE' }); posterKey = undefined }
    }
    patch = { ...patch, status: 'succeeded', result_object_key: objectKey, result_mime_type: 'video/mp4',
      result_width: measured.width, result_height: measured.height, result_metadata: { ...measured, posterKey },
      error_code: null, error_message: null }
  } catch (error) {
    const failure = error instanceof VideoProviderError ? error : new VideoProviderError('VIDEO_RESULT_STORAGE', '视频保存暂时失败，正在重试', true)
    const transferExpired = providerParams.transferStartedAt !== undefined && runtime.now() - Number(providerParams.transferStartedAt) >= VIDEO_TRANSFER_WINDOW_MS
    runtime.log({ stage: 'video-advance', jobId: job.id, code: failure.code, retryable: failure.retryable })
    if (!failure.retryable || transferExpired) patch = { ...patch, status: 'failed', error_code: failure.code, error_message: failure.message }
  }
  return { providerParams, patch }
}
