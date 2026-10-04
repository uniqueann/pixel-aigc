import { BAILIAN_IMAGEEDIT_PROMPT_MAX } from '../shared/prompt-limits.js'
import { MAX_OUTPAINT_OUTPUT_PIXELS } from '../shared/outpaint.js'
import { outpaintCreditPrice } from '../shared/billing.js'
import sharp from 'sharp'
import { readRequestBody } from './request-body.js'
import { syncQuoteSchema, withSyncCredits, getSyncCreditResult } from './sync-billing.js'
import { billingCatalog, createCreditCheckout, getCreditOrder, listCreditOrders, requestCashRefund, handlePaymentWebhook, reconcilePendingCreditOrders } from './payments/service.js'
import type { VercelRequest, VercelResponse } from './http.js'
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { waitUntil } from '@vercel/functions'
import { SEEDANCE_VIDEO_MODEL } from '../shared/video-models.js'
import { videoGenerationAvailable } from './video-providers/seedance/config.js'
import { maintainVideoJobs, recordVideoCallback } from './video-jobs/maintenance.js'
import { z } from 'zod'
import { authenticate } from './auth.js'
import { database, withIdentity } from './db.js'
import { describeError, HttpError } from './errors.js'
import { identifier, projectWriteSchema, uploadSchema } from '../shared/cloud.js'
import { readProject, requireProject, toAsset, validateReferences } from './projects.js'
import { putObject, signRead, signUpload, verifyAndPromote } from './storage.js'
import { handleModelRoute } from './model-settings.js'
import { handlePreferencesRoute } from './preferences.js'
import { handleEmailTaskRoute } from './email-tasks.js'
import { handleImageTaskRoute, peekImageTask } from './image-jobs/route.js'
import { IMAGE_TASK_CAPABILITIES } from './image-jobs/service.js'
import { imageModelsAvailable, publicConfiguredImageModels } from './image-providers/registry.js'
import { handleTaskInputs } from './task-inputs.js'
import { loadOwnedObject, objectContentDisposition, signOwnedObjectRead } from './objects.js'
import { detectGoodsSubject, tencentCiConfig } from './tencent-ci.js'
import { removeBackground } from './bg-remove.js'
import { BG_REMOVE_MAX_PIXELS } from './bg-remove-image.js'
import { eraseWithBailian } from './bailian-erase.js'
import { loadEraseStoredImage, loadStoredSyncImage, validateSyncImage } from './erase-storage.js'
import { createDashScopeLog } from './dashscope.js'
import { bailianConfig, expandWithBailian } from './bailian-outpaint.js'
import { repaintWithBailian } from './bailian-repaint.js'
import { segmentConfigured } from './segment/providers.js'
import { selectSmartMask, SmartSelectFailure } from './segment/select.js'
import { withSyncLimit } from './sync-limits.js'
import type { SyncRequestMetrics } from './sync-limits.js'
import { measureDetectionSync, type DetectionObserver } from './detection-timing.js'
import { DETECTION_CLIENT_STAGES } from '../shared/detection.js'
import { listCreditLedger } from './credits.js'
import { ensureCreditAccount } from './image-jobs/billing.js'

const SYNC_PROVIDER_DEADLINE_MS = 100_000
const clientTimingSchema = z.object({
  prepare: z.number().int().min(0).max(300_000),
  upload: z.number().int().min(0).max(300_000),
}).strict()

const detectionClientTimingSchema = z.object(Object.fromEntries(DETECTION_CLIENT_STAGES.map(stage => [stage, z.number().int().min(0).max(300_000).optional()]))).strict()
function detectionObserver(metrics: SyncRequestMetrics, userId: string): DetectionObserver {
  return entry => {
    if (typeof entry.stage === 'string' && typeof entry.ms === 'number') metrics.stageMs[entry.stage] = (metrics.stageMs[entry.stage] ?? 0) + entry.ms
    console.info(JSON.stringify({ evt: 'detection-stage', route: metrics.route, requestId: metrics.requestId, userId, ...entry }))
  }
}
function applyDetectionClientTiming(metrics: SyncRequestMetrics, timings?: Record<string, number | undefined>) {
  for (const stage of DETECTION_CLIENT_STAGES) if (timings?.[stage] !== undefined) metrics.stageMs['client' + stage[0].toUpperCase() + stage.slice(1)] = timings[stage]!
}
async function detectionResponse<T>(metrics: SyncRequestMetrics, action: () => Promise<T>) {
  try {
    const result = await action()
    metrics.outputBytes = Buffer.byteLength(JSON.stringify(result))
    return result
  } catch (error) {
    const session = error instanceof SmartSelectFailure ? error.session : null
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError
    metrics.outputBytes = Buffer.byteLength(JSON.stringify({ error: error instanceof HttpError ? error.message : invalid ? '请求参数无效' : '服务暂时不可用，请稍后重试', code: error instanceof HttpError ? error.code : invalid ? 'INVALID_REQUEST' : 'SERVER_ERROR', requestId: metrics.requestId, ...(error instanceof HttpError ? error.extra ?? {} : {}), ...(session ? { session } : {}) }))
    throw error
  }
}

function recordSyncTiming(metrics: SyncRequestMetrics, entry: Record<string, unknown>) {
  if (typeof entry.stage === 'string' && typeof entry.ms === 'number' && Number.isFinite(entry.ms) && entry.stage !== 'poll') {
    metrics.stageMs[entry.stage] = entry.ms
    if (typeof entry.pass === 'number') metrics.stageMs[`${entry.stage}Pass${entry.pass}`] = entry.ms
  }
  if (entry.stage === 'plan' && typeof entry.encodeMs === 'number') metrics.stageMs.plan = entry.encodeMs
}

async function storeSyncImageResult(
  route: SyncRequestMetrics['route'], userId: string, requestId: string,
  bytes: Buffer, metrics: SyncRequestMetrics, deadlineAt?: number, mimeType: 'image/jpeg' | 'image/png' = 'image/jpeg',
) {
  metrics.outputBytes = bytes.length
  const objectKey = `temporary/${route}-results/${userId}/${requestId}.${mimeType === 'image/png' ? 'png' : 'jpg'}`
  const writeStarted = Date.now()
  const signal = deadlineAt ? AbortSignal.timeout(Math.max(1, deadlineAt - writeStarted)) : undefined
  try {
    if (signal) await putObject(objectKey, bytes, mimeType, signal)
    else await putObject(objectKey, bytes, mimeType)
  } catch (error) {
    if (signal?.aborted) throw new HttpError(504, '结果保存超时，请重试', 'IMAGE_RESULT_TIMEOUT', { cause: error, stage: 'objectWrite' })
    throw error
  } finally {
    metrics.stageMs.objectWrite = Date.now() - writeStarted
  }
  return { kind: 'object' as const, objectKey, signed: await signRead(objectKey, 900), bytes: bytes.length, mimeType }
}

function sendSyncImageResult(res: VercelResponse, result: Awaited<ReturnType<typeof storeSyncImageResult>>) {
  res.status(200).json({ objectKey: result.objectKey, mimeType: result.mimeType, bytes: result.bytes, ...result.signed })
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const requestId = randomUUID(), start = Date.now()
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('X-Request-Id', requestId)
  let userId: string | undefined
  try {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const route = url.searchParams.get('__route') ?? url.pathname.replace(/^\/api/, '')
    const path = route.split('/').filter(Boolean).map(decodeURIComponent)
    const method = req.method ?? 'GET'
    const heavy = ['bg-remove','subject-detect','outpaint','erase','repaint','smart-select'].includes(path[0])
    await readRequestBody(req,path[0] === 'repaint' ? 48*1024*1024 : heavy ? 28*1024*1024 : 3*1024*1024)
    if (path[0] === 'payments' && path[2] === 'webhook' && path.length === 3 && method === 'POST') {
      const provider = z.enum(['creem','dodo']).parse(path[1])
      if (typeof req.rawBody !== 'string') throw new HttpError(400,'支付回调缺少原始请求体','RAW_BODY_REQUIRED')
      res.status(200).json(await handlePaymentWebhook(provider,req.rawBody,req.headers))
      return
    }
    if (path.join('/') === 'internal/credit-payments-reconcile' && method === 'GET') {
      const secret=process.env.CRON_SECRET, supplied=req.headers.authorization?.replace(/^Bearer /,'') ?? ''
      if (!secret || Buffer.byteLength(supplied)!==Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied),Buffer.from(secret)))
        throw new HttpError(401,'未授权','AUTH_REQUIRED')
      res.status(202).json({received:true})
      waitUntil(reconcilePendingCreditOrders().catch(()=>console.error(JSON.stringify({evt:'credit-payments',code:'RECONCILE_FAILED'}))))
      return
    }
    if (path.join('/') === 'internal/video-jobs-callback' && method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
      if (Buffer.byteLength(JSON.stringify(body ?? null)) > 64 * 1024) throw new HttpError(413, '回调内容过大')
      const jobId = await recordVideoCallback(url.searchParams, body)
      res.status(202).json({ received: true })
      if (jobId) waitUntil(maintainVideoJobs(jobId).catch(() => console.error(JSON.stringify({ evt: 'video-maintenance', code: 'CALLBACK_ADVANCE_FAILED' }))))
      return
    }
    if (path.join('/') === 'internal/video-jobs-maintenance' && method === 'POST') {
      const secret = process.env.VIDEO_CRON_SECRET
      const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      if (!secret || Buffer.byteLength(supplied) !== Buffer.byteLength(secret) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret))) throw new HttpError(401, '未授权', 'AUTH_REQUIRED')
      res.status(202).json({ received: true })
      waitUntil(maintainVideoJobs().catch(() => console.error(JSON.stringify({ evt: 'video-maintenance', code: 'MAINTENANCE_FAILED' }))))
      return
    }
    if ((path.join('/') === 'internal/email-cleanup' || path.join('/') === 'internal/image-jobs-sweep') && method === 'GET') {
      const secret = process.env.CRON_SECRET
      const supplied = req.headers.authorization?.replace(/^Bearer /, '') ?? ''
      if (!secret || supplied.length !== secret.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(secret)))
        throw new HttpError(401, '未授权', 'AUTH_REQUIRED')
      const result = await database().begin(async sql => {
        await sql`set local role aigc_api`
        if (path.join('/') === 'internal/image-jobs-sweep') {
          const [expired] = await sql`select aigc.expire_overdue_image_jobs() as expired`
          const [deleted] = await sql`select aigc.purge_expired_image_jobs() as deleted`
          const [limited] = await sql`select aigc.purge_expired_sync_requests() as deleted`
          const [sync] = await sql`select aigc.expire_sync_credits() as expired`
          return { expired: Number(expired.expired), deleted: Number(deleted.deleted), limited: Number(limited.deleted), syncExpired:Number(sync.expired) }
        }
        const [row] = await sql`select aigc.purge_expired_email_tasks() as deleted`
        return { deleted: Number(row.deleted) }
      })
      res.status(200).json(result)
      return
    }
    if (path.join('/') === 'capabilities' && method === 'GET') {
      res.status(200).json({
        bgRemove: tencentCiConfig() !== null,
        outpaint: bailianConfig() !== null,
        erase: bailianConfig() !== null,
        repaint: bailianConfig() !== null,
        imageEdit: imageModelsAvailable('image_edit'),
        variation: imageModelsAvailable('variation'),
        textToImage: imageModelsAvailable('text_to_image'),
        textToVideo: videoGenerationAvailable(), imageToVideo: videoGenerationAvailable(),
        smartSelect: segmentConfigured(),
      })
      return
    }
    if (path[0] === 'video-models' && method === 'GET') {
      // 报价与生成开关分离：关闭时仍返回价格供面板预估，提交仍由能力开关拒绝。
      res.status(200).json({ items: [SEEDANCE_VIDEO_MODEL] })
      return
    }
    if (path[0] === 'image-models' && method === 'GET') {
      const operation = url.searchParams.get('operation')
      const parsed = operation
        ? z.enum(['image_edit', 'text_to_image', 'variation', 'inpaint', 'outpaint']).safeParse(operation)
        : undefined
      if (operation && !parsed?.success) throw new HttpError(400, '不支持的图片能力', 'INVALID_REQUEST')
      res.status(200).json({ items: publicConfiguredImageModels(parsed?.data) })
      return
    }
    const heavyRoute = path[0] === 'bg-remove' || path[0] === 'subject-detect' || path[0] === 'outpaint' || path[0] === 'erase' || path[0] === 'repaint' || path[0] === 'smart-select'
    const maxBytes = path[0] === 'repaint' ? 48 * 1024 * 1024 : heavyRoute ? 28 * 1024 * 1024 : 3 * 1024 * 1024
    const user = await authenticate(req.headers.authorization)
    userId = user.id
    const body: unknown = typeof req.body === 'string' ? JSON.parse(req.body) : req.body
    if (Buffer.byteLength(typeof body === 'string' ? body : JSON.stringify(body ?? null)) > maxBytes) throw new HttpError(413, '请求内容过大')
    if (path.join('/') === 'credits/catalog' && method === 'GET') { res.status(200).json(await billingCatalog(user)); return }
    if (path.join('/') === 'credits/checkout' && method === 'POST') { res.status(200).json(await createCreditCheckout(user,body)); return }
    if (path.join('/') === 'credits/orders' && method === 'GET') { res.status(200).json(await listCreditOrders(user)); return }
    if (path[0] === 'credits' && path[1] === 'orders' && path.length === 3 && method === 'GET') { res.status(200).json(await getCreditOrder(user,path[2])); return }
    if (path[0] === 'credits' && path[1] === 'orders' && path[3] === 'refund-request' && path.length === 4 && method === 'POST') { res.status(200).json(await requestCashRefund(user,path[2],body)); return }
    if (path[0] === 'credits' && path[1] === 'sync' && path.length === 3 && method === 'GET') { res.status(200).json(await getSyncCreditResult(user,path[2])); return }
    if (path.join('/') === 'bg-remove' && method === 'POST') {
      if (!tencentCiConfig()) throw new HttpError(503, '智能抠图尚未配置腾讯云', 'BG_REMOVE_UNCONFIGURED')
      const inlineInput = z.object({
        billing: syncQuoteSchema,
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const objectInput = z.object({
        billing: syncQuoteSchema,
        sourceImageKey: z.string().min(1).max(512), clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const input = z.union([objectInput, inlineInput]).parse(body)
      const objectTransport = 'sourceImageKey' in input
      const metrics: SyncRequestMetrics = {
        route: 'bg-remove', requestId, transport: objectTransport ? 'object' : 'inline',
        inputBytes: 0, maskBytes: 0, stageMs: {},
      }
      if (input.clientTimingMs) {
        metrics.stageMs.clientPrepare = input.clientTimingMs.prepare
        metrics.stageMs.clientUpload = input.clientTimingMs.upload
      }
      const log = (entry: Record<string, unknown>) => {
        recordSyncTiming(metrics, entry)
        console.info(JSON.stringify({ evt: 'bg-remove', requestId, userId, ...entry }))
      }
      const result = await withSyncCredits(user, 'bg-remove', input.billing, input, () => withSyncLimit(user, 'detection', async () => {
        let image: Buffer
        if (objectTransport) {
          image = (await loadStoredSyncImage(user.id, input.sourceImageKey, 'source',
            AbortSignal.timeout(Math.max(1, start + 100_000 - Date.now())), {
              maxPixels: BG_REMOVE_MAX_PIXELS,
              onRead: (bytes, ms) => { metrics.inputBytes = bytes; metrics.stageMs.objectRead = ms },
              onValidate: log,
            })).bytes
        } else {
          image = Buffer.from(input.dataBase64, 'base64')
          metrics.inputBytes = image.length
          if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB', 'IMAGE_TOO_LARGE')
          const validateStarted = Date.now()
          try { await validateSyncImage(image, 'source', input.mimeType, BG_REMOVE_MAX_PIXELS) }
          finally { metrics.stageMs.imageValidate = Date.now() - validateStarted }
        }
        const png = await removeBackground(image, {
          userId: user.id, requestId, sourceImageKey: objectTransport ? input.sourceImageKey : undefined,
          deadlineAt: start + 100_000, log,
        })
        return storeSyncImageResult('bg-remove', user.id, requestId, png, metrics, start + 105_000, 'image/png')
      }, metrics))
      sendSyncImageResult(res, result)
      log({ stage: 'complete', ms: Date.now() - start, status: 200, transport: metrics.transport,
        resultTransport: result.kind, bytes: metrics.outputBytes, stageMs: metrics.stageMs })
      return
    }
    if (path.join('/') === 'subject-detect' && method === 'POST') {
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        width: z.number().int().positive().max(20000),
        height: z.number().int().positive().max(20000),
        clientTimingMs: detectionClientTimingSchema.optional(),
      }).strict().parse(body)
      const metrics: SyncRequestMetrics = { route: 'subject-detect', requestId, transport: 'inline', inputBytes: 0, maskBytes: 0, stageMs: {} }
      applyDetectionClientTiming(metrics, input.clientTimingMs)
      const log = detectionObserver(metrics, user.id)
      const image = measureDetectionSync(log, 'inputParse', () => Buffer.from(input.dataBase64, 'base64'))
      metrics.inputBytes = image.length
      if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
      log({ requestBytes: Buffer.byteLength(JSON.stringify(body)) })
      const result = await withSyncLimit(user, 'detection', () => detectionResponse(metrics, async () => ({ box: await detectGoodsSubject(image, input.width, input.height, undefined, undefined, log), requestId })), metrics)
      res.status(200).json(result)
      log({ operation: 'complete', durationMs: Date.now() - start, outputBytes: metrics.outputBytes! })
      return
    }
    if (path.join('/') === 'outpaint' && method === 'POST') {
      if (!bailianConfig()) throw new HttpError(503, '智能扩展尚未配置阿里云百炼 API Key', 'OUTPAINT_UNAVAILABLE')
      const padding = z.object({
        left: z.number().int().min(0).max(20000),
        right: z.number().int().min(0).max(20000),
        top: z.number().int().min(0).max(20000),
        bottom: z.number().int().min(0).max(20000),
      }).strict()
      const inlineInput = z.object({
        billing: syncQuoteSchema,
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        padding,
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const objectInput = z.object({
        billing: syncQuoteSchema,
        sourceImageKey: z.string().min(1).max(512),
        padding,
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const input = z.union([objectInput, inlineInput]).parse(body)
      const objectTransport = 'sourceImageKey' in input
      const metrics: SyncRequestMetrics = {
        route: 'outpaint', requestId, transport: objectTransport ? 'object' : 'inline',
        inputBytes: 0, maskBytes: 0, stageMs: {},
      }
      if (input.clientTimingMs) {
        metrics.stageMs.clientPrepare = input.clientTimingMs.prepare
        metrics.stageMs.clientUpload = input.clientTimingMs.upload
      }
      const outpaintLog = createDashScopeLog('outpaint')
      const result = await withSyncCredits(user, 'outpaint', input.billing, input, () => withSyncLimit(user, 'generation', async () => {
        let image: Buffer
        if (objectTransport) {
          const readStarted = Date.now()
          const signal = AbortSignal.timeout(Math.max(1, start + SYNC_PROVIDER_DEADLINE_MS - Date.now()))
          image = (await loadStoredSyncImage(user.id, input.sourceImageKey, 'source', signal, {
            maxPixels: MAX_OUTPAINT_OUTPUT_PIXELS,
            onRead: (bytes, ms) => { metrics.inputBytes = bytes; metrics.stageMs.objectRead = ms },
            onValidate: entry => { outpaintLog({ requestId, ...entry }); recordSyncTiming(metrics, entry) },
          })).bytes
          metrics.stageMs.objectRead ??= Date.now() - readStarted
        } else {
          image = Buffer.from(input.dataBase64, 'base64')
        }
        metrics.inputBytes = image.length
        if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
        const processStarted = Date.now()
        if (!objectTransport) {
          const validateStarted = Date.now()
          try { await validateSyncImage(image, 'source', input.mimeType, MAX_OUTPAINT_OUTPUT_PIXELS) }
          finally { metrics.stageMs.imageValidate = Date.now() - validateStarted }
        }
        const size = await sharp(image).metadata()
        const chargedCredits = outpaintCreditPrice(size.width!,size.height!,input.padding)
        if (chargedCredits>input.billing.maxCredits) throw new HttpError(409,'扩图报价已变化，请重新确认','PRICE_CHANGED')
        const jpeg = await expandWithBailian(image, input.padding, {
          requestId, deadlineAt: start + SYNC_PROVIDER_DEADLINE_MS,
          log: entry => { outpaintLog(entry); recordSyncTiming(metrics, entry) },
        })
        metrics.stageMs.process = Date.now() - processStarted
        return { ...await storeSyncImageResult('outpaint', user.id, requestId, jpeg, metrics, start + 105_000), chargedCredits }
      }, metrics))
      sendSyncImageResult(res, result)
      console.info(JSON.stringify({
        evt: 'outpaint', requestId, userId, status: 200, route: 'outpaint',
        region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - start,
        transport: metrics.transport, bytes: metrics.outputBytes, stageMs: metrics.stageMs,
      }))
      return
    }
    if (path.join('/') === 'erase' && method === 'POST') {
      if (!bailianConfig()) throw new HttpError(503, '图片消除尚未配置阿里云百炼 API Key', 'ERASE_UNAVAILABLE')
      const inlineInput = z.object({
        billing: syncQuoteSchema,
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        maskMimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']).optional(),
        maskBase64: z.string().min(1),
        prompt: z.string().max(BAILIAN_IMAGEEDIT_PROMPT_MAX).optional(),
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const objectInput = z.object({
        billing: syncQuoteSchema,
        sourceImageKey: z.string().min(1).max(512),
        maskImageKey: z.string().min(1).max(512),
        prompt: z.string().max(BAILIAN_IMAGEEDIT_PROMPT_MAX).optional(),
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const input = z.union([objectInput, inlineInput]).parse(body)
      const objectTransport = 'sourceImageKey' in input
      const metrics: SyncRequestMetrics = {
        route: 'erase', requestId, transport: objectTransport ? 'object' : 'inline',
        inputBytes: 0, maskBytes: 0, stageMs: {},
      }
      if (input.clientTimingMs) {
        metrics.stageMs.clientPrepare = input.clientTimingMs.prepare
        metrics.stageMs.clientUpload = input.clientTimingMs.upload
      }
      const eraseLog = createDashScopeLog('erase')
      const result = await withSyncCredits(user, 'erase', input.billing, input, () => withSyncLimit(user, 'generation', async () => {
        let image: Buffer
        let mask: Buffer
        if (objectTransport) {
          const readStarted = Date.now()
          const [source, painted] = await Promise.all([
            loadEraseStoredImage(user.id, input.sourceImageKey, 'source'),
            loadEraseStoredImage(user.id, input.maskImageKey, 'mask'),
          ])
          metrics.stageMs.objectRead = Date.now() - readStarted
          if (source.width !== painted.width || source.height !== painted.height) {
            throw new HttpError(400, '蒙版尺寸与原图不一致', 'INVALID_MASK')
          }
          image = source.bytes
          mask = painted.bytes
        } else {
          image = Buffer.from(input.dataBase64, 'base64')
          mask = Buffer.from(input.maskBase64, 'base64')
        }
        metrics.inputBytes = image.length
        metrics.maskBytes = mask.length
        if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
        if (!mask.length || mask.length > 20 * 1024 * 1024) throw new HttpError(413, '蒙版不能超过 20 MB')
        const processStarted = Date.now()
        const jpeg = await eraseWithBailian(image, mask, input.prompt ?? '', {
          requestId,
          log: entry => {
            eraseLog(entry)
            recordSyncTiming(metrics, entry)
          },
        })
        metrics.stageMs.process = Date.now() - processStarted
        return storeSyncImageResult('erase', user.id, requestId, jpeg, metrics)
      }, metrics))
      sendSyncImageResult(res, result)
      console.info(JSON.stringify({
        evt: 'erase', requestId, userId, status: 200, route: 'erase',
        region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - start,
        transport: metrics.transport, bytes: metrics.outputBytes, stageMs: metrics.stageMs,
      }))
      return
    }
    if (path.join('/') === 'repaint' && method === 'POST') {
      if (!bailianConfig()) throw new HttpError(503, '重绘尚未配置阿里云百炼 API Key', 'REPAINT_UNAVAILABLE')
      const inlineInput = z.object({
        billing: syncQuoteSchema,
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
        dataBase64: z.string().min(1),
        maskBase64: z.string().min(1),
        prompt: z.string().min(1).max(BAILIAN_IMAGEEDIT_PROMPT_MAX),
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const objectInput = z.object({
        billing: syncQuoteSchema,
        sourceImageKey: z.string().min(1).max(512),
        maskImageKey: z.string().min(1).max(512),
        prompt: z.string().min(1).max(BAILIAN_IMAGEEDIT_PROMPT_MAX),
        clientTimingMs: clientTimingSchema.optional(),
      }).strict()
      const input = z.union([objectInput, inlineInput]).parse(body)
      const objectTransport = 'sourceImageKey' in input
      const metrics: SyncRequestMetrics = {
        route: 'repaint', requestId, transport: objectTransport ? 'object' : 'inline',
        inputBytes: 0, maskBytes: 0, stageMs: {},
      }
      if (input.clientTimingMs) {
        metrics.stageMs.clientPrepare = input.clientTimingMs.prepare
        metrics.stageMs.clientUpload = input.clientTimingMs.upload
      }
      const repaintLog = createDashScopeLog('repaint')
      const result = await withSyncCredits(user, 'repaint', input.billing, input, () => withSyncLimit(user, 'generation', async () => {
        let image: Buffer
        let mask: Buffer
        if (objectTransport) {
          const readStarted = Date.now()
          const signal = AbortSignal.timeout(Math.max(1, start + SYNC_PROVIDER_DEADLINE_MS - readStarted))
          const [source, painted] = await Promise.all([
            loadStoredSyncImage(user.id, input.sourceImageKey, 'source', signal),
            loadStoredSyncImage(user.id, input.maskImageKey, 'mask', signal),
          ])
          metrics.stageMs.objectRead = Date.now() - readStarted
          image = source.bytes
          mask = painted.bytes
        } else {
          image = Buffer.from(input.dataBase64, 'base64')
          mask = Buffer.from(input.maskBase64, 'base64')
        }
        metrics.inputBytes = image.length
        metrics.maskBytes = mask.length
        if (!image.length || image.length > 20 * 1024 * 1024) throw new HttpError(413, '单张图片不能超过 20 MB')
        if (!mask.length || mask.length > 20 * 1024 * 1024) throw new HttpError(413, '蒙版不能超过 20 MB')
        const processStarted = Date.now()
        const jpeg = await repaintWithBailian(image, mask, input.prompt, {
          requestId, deadlineAt: start + SYNC_PROVIDER_DEADLINE_MS,
          log: entry => { repaintLog(entry); recordSyncTiming(metrics, entry) },
        })
        metrics.stageMs.process = Date.now() - processStarted
        return storeSyncImageResult('repaint', user.id, requestId, jpeg, metrics, start + 105_000)
      }, metrics))
      sendSyncImageResult(res, result)
      console.info(JSON.stringify({
        evt: 'repaint', requestId, userId, status: 200, route: 'repaint',
        region: process.env.VERCEL_REGION ?? null, durationMs: Date.now() - start,
        transport: metrics.transport, bytes: metrics.outputBytes, stageMs: metrics.stageMs,
      }))
      return
    }
    if (path.join('/') === 'smart-select' && method === 'POST') {
      const norm = z.number().min(0).max(1)
      const input = z.object({
        mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
        dataBase64: z.string().min(1).optional(),
        point: z.object({ x: norm, y: norm }).strict(),
        box: z.object({ x: norm, y: norm, width: z.number().positive().max(1), height: z.number().positive().max(1) }).strict().optional(),
        session: z.object({ provider: z.string().min(1).max(64), payload: z.string().min(1).max(6_000_000) }).strict().optional(),
        clientTimingMs: detectionClientTimingSchema.optional(),
      }).strict().parse(body)
      if (!input.dataBase64 && !input.session) throw new HttpError(400, '缺少图片', 'SMART_SELECT_IMAGE_REQUIRED')
      const metrics: SyncRequestMetrics = { route: 'smart-select', requestId, transport: 'inline', inputBytes: 0, maskBytes: 0, stageMs: {} }
      applyDetectionClientTiming(metrics, input.clientTimingMs)
      const log = detectionObserver(metrics, user.id)
      const image = measureDetectionSync(log, 'inputParse', () => input.dataBase64 ? Buffer.from(input.dataBase64, 'base64') : undefined)
      metrics.inputBytes = (image?.length ?? 0) + (input.session ? Buffer.byteLength(input.session.payload) : 0)
      if (image && !image.length) throw new HttpError(400, '缺少图片', 'SMART_SELECT_IMAGE_REQUIRED')
      log({ requestBytes: Buffer.byteLength(JSON.stringify(body)) })
      const result = await withSyncLimit(user, 'detection', () => detectionResponse(metrics, async () => {
        const selected = await selectSmartMask({
          image,
          point: input.point,
          box: input.box,
          session: input.session,
        }, undefined, log)
        if ('miss' in selected && selected.miss) metrics.errorCode = selected.code
        return { ...selected, requestId }
      }), metrics)
      res.status(200).json(result)
      console.info(JSON.stringify({
        evt: 'smart-select', requestId, userId, status: 200, route: 'smart-select',
        provider: result.session?.provider ?? null, durationMs: Date.now() - start,
        outcome: 'miss' in result && result.miss ? 'miss' : 'success',
      }))
      return
    }
    if (path[0] === 'preferences') {
      res.status(200).json(await handlePreferencesRoute(user, method, path, body))
      return
    }
    if (path[0] === 'model-settings' || path[0] === 'model-profiles') {
      res.status(200).json(await handleModelRoute(user, method, path, body))
      return
    }
    if (path[0] === 'task-inputs' && path.length === 1) {
      res.status(200).json(await handleTaskInputs(user, method, body))
      return
    }
    if (path[0] === 'objects' && path.length === 1 && method === 'GET') {
      const key = url.searchParams.get('key') ?? ''
      if (url.searchParams.get('mode') === 'url') {
        res.setHeader('Cache-Control', 'private, no-store')
        res.status(200).json(await signOwnedObjectRead(user, key, url.searchParams.get('disposition') === 'attachment'
          ? url.searchParams.get('filename')?.trim() || '视频.mp4' : undefined))
        return
      }
      const downloaded = await loadOwnedObject(user, key)
      const filename = url.searchParams.get('filename')?.trim()
      res.setHeader('Content-Type', downloaded.contentType)
      res.setHeader('Cache-Control', 'private, no-store')
      if (url.searchParams.get('download') === '1' && filename) {
        res.setHeader('Content-Disposition', objectContentDisposition(filename))
      }
      res.status(200).end(Buffer.from(downloaded.bytes))
      return
    }
    if (path[0] === 'tasks') {
      if (method === 'POST') {
        const capability = body && typeof body === 'object' && 'capability' in body
          ? String((body as { capability?: unknown }).capability) : ''
        if (IMAGE_TASK_CAPABILITIES.has(capability) || capability === 'text_to_video') {
          res.status(200).json(await handleImageTaskRoute(user, method, path, body, url.searchParams))
          return
        }
        if (capability && capability !== 'email_assist') {
          throw new HttpError(501, '该能力尚未接入真实任务', 'CAPABILITY_UNAVAILABLE')
        }
        res.status(200).json(await handleEmailTaskRoute(user, method, path, body, url.searchParams))
        return
      }
      if (method === 'GET' && path.length === 1 && (IMAGE_TASK_CAPABILITIES.has(url.searchParams.get('capability') ?? '') || url.searchParams.get('capability') === 'text_to_video')) {
        res.status(200).json(await handleImageTaskRoute(user, method, path, body, url.searchParams))
        return
      }
      if (path.length === 2) {
        const id = z.uuid().safeParse(path[1])
        if (id.success && await peekImageTask(user, id.data)) {
          res.status(200).json(await handleImageTaskRoute(user, method, path, body, url.searchParams))
          return
        }
      }
      if (path[1] === 'by-request' && path.length === 3 && method === 'GET') {
        const image = await handleImageTaskRoute(user, method, path, body, url.searchParams)
        if (image) {
          res.status(200).json(image)
          return
        }
      }
      res.status(200).json(await handleEmailTaskRoute(user, method, path, body, url.searchParams))
      return
    }
    const result = await withIdentity(user.id, user.email, async sql => {
      if (path.join('/') === 'me' && method === 'POST') {
        const [row] = await sql`select aigc.initialize_member(${user.suggestedName}) as allowed`
        if (!row.allowed) throw new HttpError(403, '当前账号已被停用，请联系管理员', 'MEMBER_DISABLED')
        return accountContext(sql, user)
      }
      const [member] = await sql`select status from aigc.members where user_id=${user.id}`
      if (!member) throw new HttpError(403, '当前账号尚未初始化', 'MEMBER_UNAVAILABLE')
      if (member.status !== 'active') throw new HttpError(403, '当前账号已被停用，请联系管理员', 'MEMBER_DISABLED')
      if (path.join('/') === 'me' && method === 'GET') return accountContext(sql, user)
      if (path.join('/') === 'credits/ledger' && method === 'GET') {
        await ensureCreditAccount(sql, user.id)
        return listCreditLedger(sql, url.searchParams.get('cursor'))
      }
      if (path.join('/') === 'me' && method === 'PATCH') {
        const { displayName } = z.object({ displayName: z.string().trim().min(1).max(80) }).strict().parse(body)
        await sql`update aigc.members set display_name=${displayName},updated_at=now() where user_id=${user.id}`
        return accountContext(sql, user)
      }
      if (path[0] === 'workspaces' && path.length === 2 && method === 'PATCH') {
        const workspaceId = z.uuid().parse(path[1])
        const { name } = z.object({ name: z.string().trim().min(1).max(80) }).strict().parse(body)
        const rows = await sql`update aigc.workspaces set name=${name},updated_at=now() where id=${workspaceId} and owner_id=${user.id} returning id`
        if (!rows.length) throw new HttpError(404, '工作空间不存在或无权访问', 'NOT_FOUND')
        return accountContext(sql, user)
      }
      if (path[0] === 'projects') {
        if (path.length === 1 && method === 'GET') {
          const rows = await sql`select id,name,revision,updated_at as "updatedAt" from aigc.projects where deleted_at is null order by updated_at desc limit 200`
          return { items: rows }
        }
        if (path.length === 1 && method === 'POST') {
          const { id, ...input } = projectWriteSchema.extend({ id: identifier }).parse(body)
          // 创建接口只接收空素材文档；随后上传素材，再进行版本化保存。
          if (input.document.scenes.some(s => s.nodes.some(n => ['image','video','generation'].includes(n.type))) || input.drafts.derived)
            throw new HttpError(400, '请先创建项目，再上传关联素材')
          const [space] = await sql`select id from aigc.workspaces where owner_id=${user.id}`
          if (!space) throw new HttpError(403, '个人工作空间不可用', 'WORKSPACE_UNAVAILABLE')
          const rows = await sql`insert into aigc.projects(id,user_id,workspace_id,name,document,drafts) values(${id},${user.id},${space.id},${input.name},${sql.json(input.document)},${sql.json(input.drafts)}) on conflict(id) do nothing returning id`
          if (!rows.length) {
            const existing = await requireProject(sql, id)
            if (existing.revision !== 1) throw new HttpError(409, '项目已存在，请从云端打开或另存为新项目')
          }
          return readProject(sql, id)
        }
        if (path.length === 2) {
          const id = identifier.parse(path[1])
          if (method === 'GET') return readProject(sql, id)
          if (method === 'PUT') {
            const { baseRevision, ...input } = projectWriteSchema.extend({ baseRevision: z.number().int().positive() }).parse(body)
            const current = await requireProject(sql, id, true)
            if (current.revision !== baseRevision) throw new HttpError(409, '云端项目已更新，请处理版本冲突')
            await validateReferences(sql, id, input)
            const [row] = await sql`update aigc.projects set name=${input.name},document=${sql.json(input.document)},drafts=${sql.json(input.drafts)},revision=revision+1,updated_at=now() where id=${id} returning revision`
            return { revision: row.revision }
          }
          if (method === 'DELETE') {
            await requireProject(sql, id, true)
            await sql`update aigc.projects set deleted_at=now(),updated_at=now(),revision=revision+1 where id=${id}`
            return { deleted: true }
          }
        }
      }
      if (path.join('/') === 'assets/uploads' && method === 'POST') {
        const input = uploadSchema.parse(body)
        await requireProject(sql, input.projectId)
        const token = randomUUID()
        const key = `media/${user.id}/${token}`
        await sql`insert into aigc.assets(id,project_id,user_id,name,mime_type,size,object_key,temp_key) values(${input.assetId},${input.projectId},${user.id},${input.name},${input.mimeType},${input.size},${key},${'temporary/' + token}) on conflict(project_id,id) do nothing`
        const [row] = await sql`select * from aigc.assets where project_id=${input.projectId} and id=${input.assetId}`
        if (!row || row.size !== input.size || row.mime_type !== input.mimeType) throw new HttpError(409, '素材标识已用于其他文件')
        if (row.status === 'ready') return { asset: toAsset(row) }
        return { uploadUrl: await signUpload(row.temp_key, row.mime_type, row.size), assetId: row.id }
      }
      if (path[0] === 'assets' && path[2] === 'complete' && path.length === 3 && method === 'POST') {
        const { projectId } = z.object({ projectId: identifier }).parse(body)
        await requireProject(sql, projectId)
        const [row] = await sql`select * from aigc.assets where project_id=${projectId} and id=${path[1]} for update`
        if (!row) throw new HttpError(404, '素材不存在')
        if (row.status !== 'ready') {
          const size = await verifyAndPromote(row.temp_key, row.object_key, row.size, row.mime_type)
          const [updated] = await sql`update aigc.assets set status='ready',width=${size.width},height=${size.height} where project_id=${projectId} and id=${row.id} returning *`
          return { asset: toAsset(updated) }
        }
        return { asset: toAsset(row) }
      }
      if (path.join('/') === 'assets/access' && method === 'POST') {
        const { projectId, assetIds } = z.object({ projectId: identifier, assetIds: z.array(identifier).min(1).max(100) }).parse(body)
        await requireProject(sql, projectId)
        const rows = await sql`select id,object_key from aigc.assets where project_id=${projectId} and status='ready' and id in ${sql([...new Set(assetIds)])}`
        if (rows.length !== new Set(assetIds).size) throw new HttpError(404, '素材不存在或无权访问')
        return { items: await Promise.all(rows.map(async row => ({ id: row.id, ...await signRead(row.object_key) }))) }
      }
      throw new HttpError(404, '接口不存在')
    })
    res.status(200).json(result)
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof z.ZodError || error instanceof SyntaxError ? 400 : 500
    const message = error instanceof HttpError ? error.message : status === 400 ? '请求参数无效' : '服务暂时不可用，请稍后重试'
    const code = error instanceof HttpError ? error.code : status === 400 ? 'INVALID_REQUEST' : 'SERVER_ERROR'
    const session = error instanceof SmartSelectFailure ? error.session : null
    const extra = error instanceof HttpError ? error.extra : undefined
    const retryAfter = extra && typeof extra.retryAfterSeconds === 'number' ? extra.retryAfterSeconds : undefined
    if (retryAfter && retryAfter > 0) res.setHeader('Retry-After', String(Math.ceil(retryAfter)))
    res.status(status).json({ error: message, code, requestId, ...(extra ?? {}), ...(session ? { session } : {}) })
    const details = describeError(error)
    console.error(JSON.stringify({
      requestId, userId, status, category: details.name, durationMs: Date.now() - start,
      message: details.message, cause: details.cause ?? null, stage: details.stage ?? null,
    }))
  }
}

async function accountContext(sql: import('./db.js').Transaction, user: Awaited<ReturnType<typeof authenticate>>) {
  await sql`select aigc.expire_overdue_image_jobs(${user.id})`
  const balance = await ensureCreditAccount(sql, user.id)
  const [row] = await sql`select m.display_name as "displayName", w.id as "workspaceId",w.name as "workspaceName",wm.role
    from aigc.members m join aigc.workspaces w on w.owner_id=m.user_id
    join aigc.workspace_members wm on wm.workspace_id=w.id and wm.user_id=m.user_id and wm.status='active'
    where m.user_id=${user.id} and m.status='active'`
  if (!row) throw new HttpError(403, '账号资料不可用', 'PROFILE_UNAVAILABLE')
  return { userId: user.id, email: user.email, emailVerified: true, displayName: row.displayName, credits: balance,
    avatarUrl: user.avatarUrl, providers: user.providers, status: 'active',
    workspace: { id: row.workspaceId, name: row.workspaceName, type: 'personal', role: row.role } }
}
