import { readFileSync } from 'node:fs'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { SEEDANCE_VIDEO_MODEL, VIDEO_RETENTION_MS } from '../../shared/video-models.js'
import { createMemoryStore } from '../image-jobs/memory-store.js'
import { defaultImageJobRuntime, finalizeJob } from '../image-jobs/service.js'
import { VideoProviderError } from '../video-providers/types.js'
import { probeVideo } from '../video-providers/metadata.js'
import { applyVideoSubmission, collectVideoOutcome, createVideoJobInStore, createVideoTaskSchema, prepareVideoSource, toClientVideoTask,
  VIDEO_DEADLINE_MS, VIDEO_TRANSFER_WINDOW_MS, type VideoJobRuntime } from './service.js'

const user = { id: '00000000-0000-4000-8000-000000000001' }
const sourceKey = `temporary/task-inputs/${user.id}/source`
function payload(durationSeconds: 5 | 10 = 5, overrides: Record<string, unknown> = {}) {
  return createVideoTaskSchema.parse({ capability: 'text_to_video', requestId: '00000000-0000-4000-8000-000000000002',
    modelProfileId: SEEDANCE_VIDEO_MODEL.id, priceVersion: SEEDANCE_VIDEO_MODEL.pricing.version,
    params: { mode: 'text_to_video', prompt: '雨夜城市', ratio: '16:9', resolution: '720p', count: 1, size: { width: 1280, height: 720 }, durationSeconds, generateAudio: false, ...overrides } })
}
function runtime() {
  let now = Date.now()
  const rt = { ...defaultImageJobRuntime(), now: () => now, setNow: (value: number) => { now = value },
    billing: { reserve: vi.fn(async () => ({ ok: true as const })), settle: vi.fn(async () => {}), release: vi.fn(async () => {}) },
    videoProvider: { id: 'seedance', submit: vi.fn(async () => ({ providerTaskId: 'cgt-task' })),
      getStatus: vi.fn(async () => ({ state: 'succeeded' as const, model: SEEDANCE_VIDEO_MODEL.model, videoUrl: 'https://a.volces.com/video.mp4' })),
      fetchResult: vi.fn(async () => readFileSync('public/mock/text-to-video-5s.mp4')) },
    readSource: vi.fn(), writeVideo: vi.fn(async () => {}), probe: probeVideo,
    callbackUrl: () => 'https://example.test/callback', log: vi.fn(),
    signRead: vi.fn(async (key: string, ttl = 900) => ({ url: `https://r2.test/${key}`, expiresAt: now + ttl * 1000 })),
  } satisfies VideoJobRuntime & { setNow: (value: number) => void }
  return rt
}
async function created(rt = runtime()) {
  const store = createMemoryStore(user.id)
  const { bundle } = await createVideoJobInStore(store, user, payload(), rt)
  await applyVideoSubmission(store, bundle.job.id, rt, 'cgt-task')
  return { rt, store, bundle: { job: (await store.findById(bundle.job.id))!, items: await store.listItems(bundle.job.id) } }
}

describe('视频任务提交、转存与共用计费', () => {
  it.each([[5, 50], [10, 100]] as const)('%i 秒预扣 %i 积分，重复请求不再次预扣', async (duration, credits) => {
    const store = createMemoryStore(user.id), rt = runtime(), request = payload(duration)
    const first = await createVideoJobInStore(store, user, request, rt)
    const repeated = await createVideoJobInStore(store, user, request, rt)
    expect(repeated.created).toBe(false)
    expect(first.bundle.job.credits_reserved).toBe(credits)
    expect(first.bundle.items[0]).toMatchObject({ status: 'submitted', attempts: 1 })
    expect(rt.billing.reserve).toHaveBeenCalledTimes(1)
    await expect(createVideoJobInStore(store, user, { ...request, params: { ...request.params, generateAudio: true } }, rt)).rejects.toMatchObject({ code: 'REQUEST_CONFLICT' })
  })
  it('价格版本不匹配、参数越界和余额不足都不创建任务', async () => {
    const rt = runtime(), store = createMemoryStore(user.id)
    await expect(createVideoJobInStore(store, user, { ...payload(), priceVersion: '旧价格' }, rt)).rejects.toMatchObject({ code: 'VIDEO_PRICE_CHANGED' })
    expect(() => payload(5, { resolution: '1080p' })).toThrow()
    expect(() => payload(5, { count: 2 })).toThrow()
    expect(() => payload(5, { sourceImageUrl: 'https://evil.test/a' })).toThrow()
    rt.billing.reserve.mockResolvedValueOnce({ ok: false, code: 'INSUFFICIENT_CREDITS', message: '积分不足', required: 50, balance: 0 } as never)
    await expect(createVideoJobInStore(store, user, payload(), rt)).rejects.toMatchObject({ status: 402 })
    expect(store.jobs.size).toBe(0)
  })
  it('图生输入检查所有权和真实尺寸，忽略客户端提供的外部 URL', async () => {
    const rt = runtime()
    const request = payload(5, { mode: 'image_to_video', ratio: 'adaptive', sourceImageKey: sourceKey, sourceImageUrl: 'https://evil.test/a' })
    const bytes = await sharp({ create: { width: 600, height: 400, channels: 3, background: 'red' } }).png().toBuffer()
    rt.readSource.mockResolvedValue({ bytes, contentType: 'image/png' })
    await expect(prepareVideoSource(user.id, request, rt)).resolves.toContain(sourceKey)
    expect(rt.signRead).toHaveBeenCalledWith(sourceKey, 7200)
    await expect(prepareVideoSource('其他账号', request, rt)).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    rt.readSource.mockResolvedValue({ bytes: await sharp(bytes).resize(100, 100).png().toBuffer() })
    await expect(prepareVideoSource(user.id, request, rt)).rejects.toMatchObject({ code: 'VIDEO_IMAGE_NOT_SUPPORTED' })
    expect(rt.billing.reserve).not.toHaveBeenCalled()
  })
  it('提交响应迟于回调时保留转存租约；不确定失败不会退款或重新 POST', async () => {
    const { rt, store, bundle } = await created()
    const lease = new Date(rt.now() + 120_000)
    await store.updateJob(bundle.job.id, { lease_until: lease, provider_params: { ...bundle.job.provider_params, phase: 'transferring', callbackTaskId: 'cgt-task' } })
    const applied = await applyVideoSubmission(store, bundle.job.id, rt, 'cgt-task')
    expect(applied.job.lease_until).toEqual(lease)
    expect(applied.job.provider_params.phase).toBe('transferring')
    await applyVideoSubmission(store, bundle.job.id, rt, undefined, new VideoProviderError('UPSTREAM_UNAVAILABLE', '确认中', true, true))
    expect(rt.billing.release).not.toHaveBeenCalled()
    expect(rt.videoProvider.submit).not.toHaveBeenCalled()
  })
  it('已转存真实字节后才结算，并以交付时间计算 30 天保留期', async () => {
    const { rt, store, bundle } = await created()
    const checkpoint = vi.fn(async () => {})
    const outcome = await collectVideoOutcome(bundle, rt, checkpoint)
    expect(checkpoint).toHaveBeenCalledWith(expect.objectContaining({ phase: 'transferring', transferAttempts: 1 }))
    expect(rt.billing.settle).not.toHaveBeenCalled()
    const item = await store.updateItem(bundle.job.id, 0, outcome.patch)
    const final = await finalizeJob(store, { ...bundle.job, provider_params: outcome.providerParams }, [item], rt, false)
    expect(rt.writeVideo).toHaveBeenCalledWith(expect.stringContaining('/video/'), expect.any(Uint8Array), 'video/mp4', expect.any(AbortSignal))
    expect(rt.billing.settle).toHaveBeenCalledWith({ jobId: bundle.job.id, charged: 50 })
    expect(new Date(final.job.expires_at).getTime()).toBe(rt.now() + VIDEO_RETENTION_MS)
    expect((await toClientVideoTask(final, rt)).resultVideos[0]).toMatchObject({ width: 640, height: 360, durationSeconds: 5, sizeBytes: 6319, hasAudio: false })
    await finalizeJob(store, final.job, final.items, rt, false)
    expect(rt.billing.settle).toHaveBeenCalledTimes(1)
  })
  it('存储暂时失败保留重试窗口，窗口截止或声音不匹配则退款', async () => {
    const { rt, store, bundle } = await created()
    rt.writeVideo.mockRejectedValue(new Error('存储故障'))
    const first = await collectVideoOutcome(bundle, rt)
    expect(first.patch.status).toBeUndefined()
    expect(first.providerParams.transferStartedAt).toBe(rt.now())
    rt.setNow(rt.now() + VIDEO_TRANSFER_WINDOW_MS)
    const timedOut = await collectVideoOutcome({ ...bundle, job: { ...bundle.job, provider_params: first.providerParams } }, rt)
    expect(timedOut.patch).toMatchObject({ status: 'failed', error_code: 'VIDEO_RESULT_TIMEOUT' })
    const item = await store.updateItem(bundle.job.id, 0, timedOut.patch)
    await finalizeJob(store, bundle.job, [item], rt, false)
    expect(rt.billing.release).toHaveBeenCalledTimes(1)
    const audio = await created()
    const invalid = await collectVideoOutcome({ ...audio.bundle, job: { ...audio.bundle.job, params: { ...audio.bundle.job.params, generateAudio: true } } }, audio.rt)
    expect(invalid.patch).toMatchObject({ status: 'failed', error_code: 'VIDEO_RESULT_INVALID' })
    expect(audio.rt.writeVideo).not.toHaveBeenCalled()
  })
  it('75 分钟截止退款一次，随后补回的结果免费交付', async () => {
    const { rt, store, bundle } = await created()
    rt.setNow(rt.now() + VIDEO_DEADLINE_MS + 1)
    const expired = await collectVideoOutcome(bundle, rt)
    expect(rt.videoProvider.getStatus).not.toHaveBeenCalled()
    const item = await store.updateItem(bundle.job.id, 0, expired.patch)
    const refunded = await finalizeJob(store, bundle.job, [item], rt, false)
    expect(refunded.job).toMatchObject({ status: 'expired', billing_state: 'released', credits_charged: 0 })
    expect((await toClientVideoTask(refunded, rt)).errorMessage).toContain('本次预扣积分已退回')
    const late = await collectVideoOutcome(refunded, rt)
    const delivered = await store.updateItem(bundle.job.id, 0, late.patch)
    const final = await finalizeJob(store, { ...refunded.job, provider_params: late.providerParams }, [delivered], rt, true)
    expect(final.job).toMatchObject({ status: 'succeeded', billing_state: 'released', credits_charged: 0, warnings: ['LATE_RESULT_NO_CHARGE'] })
    expect(rt.billing.release).toHaveBeenCalledTimes(1)
    expect(rt.billing.settle).not.toHaveBeenCalled()
  })
})
