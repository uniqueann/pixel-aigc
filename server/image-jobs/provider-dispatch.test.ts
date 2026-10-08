import { afterEach, describe, expect, it, vi } from 'vitest'
import { submitSuccess } from '../image-providers/dragoncode/fixtures.js'
import { MOCK_PNG_1X1 } from '../image-providers/mock.js'
import { imageProviderById } from '../image-providers/registry.js'
import {
  QWEN_END_TIME,
  QWEN_SCHEDULED_TIME,
  QWEN_SUBMIT_TIME,
  pollFailedModeration,
  pollRunning,
  pollSucceededContentImages,
  qwenImageUrl,
  submitPending,
  submitThrottled,
} from '../image-providers/qwen-image/fixtures.js'
import { QWEN_QUOTA_EXHAUSTED_MESSAGE, QWEN_QUEUE_FULL_MESSAGE, QWEN_THROTTLE_REFUND_MESSAGE } from '../image-providers/qwen-image/errors.js'
import { createMemoryStore } from './memory-store.js'
import {
  advanceJobInStore,
  createImageJobInStore,
  createImageTaskSchema,
  finalizeJob,
  runProviderSubmits,
  toClientImageTask,
  type ImageJobRuntime,
} from './service.js'
import type { ImageJobStore } from './types.js'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
const KEYS = [
  'DRAGONCODE_API_KEY', 'DRAGONCODE_TASK_TIMEOUT_MS', 'DRAGONCODE_INITIAL_POLL_DELAY_MS',
  'DASHSCOPE_API_KEY', 'QWEN_IMAGE_ENABLED', 'QWEN_IMAGE_TASK_TIMEOUT_MS', 'QWEN_IMAGE_INITIAL_POLL_DELAY_MS',
  'QWEN_IMAGE_REQUEST_RETRY_COUNT', 'QWEN_IMAGE_THINKING', 'QWEN_IMAGE_PROMPT_EXTEND',
  'QWEN_IMAGE_ACTIVE_LIMIT', 'QWEN_IMAGE_PRO_ACTIVE_LIMIT',
] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function runtime(fetchImpl: typeof fetch, start = Date.parse('2026-10-06T00:00:00.000Z')) {
  let now = start
  const billing = {
    reserve: vi.fn(async () => ({ ok: true as const })),
    settle: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
  const rt = {
    now: () => now,
    setNow(value: number) { now = value },
    sleep: async () => undefined,
    fetch: fetchImpl,
    log: vi.fn(),
    signRead: vi.fn(async (key: string) => ({ url: `https://r2.test/${key}`, expiresAt: now + 900_000 })),
    getObject: vi.fn(async () => ({ bytes: MOCK_PNG_1X1, contentType: 'image/png' })),
    putObject: vi.fn(async () => undefined),
    billing,
    crop: async (bytes) => ({ bytes: new Uint8Array(bytes), width: 1, height: 1, mimeType: 'image/png', cropped: false }),
    providerFor: imageProviderById,
    random: () => 0,
  } satisfies ImageJobRuntime & { setNow: (value: number) => void; billing: typeof billing }
  return rt
}

function text(requestId: string, count = 2, modelProfileId?: string) {
  return createImageTaskSchema.parse({
    capability: 'text_to_image',
    requestId,
    ...(modelProfileId ? { modelProfileId } : {}),
    params: {
      prompt: '橙色香水瓶置于浅色木桌',
      size: { width: 1280, height: 720 },
      count,
      resolution: '2k' as const,
    },
  })
}

async function applySubmits(
  store: ImageJobStore,
  created: Awaited<ReturnType<typeof createImageJobInStore>>,
  rt: ImageJobRuntime,
) {
  const outcomes = await runProviderSubmits(created.bundle, created.provider, user.id, rt)
  for (const outcome of outcomes) await store.updateItem(created.bundle.job.id, outcome.ordinal, outcome.patch)
  return store.listItems(created.bundle.job.id)
}

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('图片任务按模型供应商分发', () => {
  it('开关打开后默认仍走 GPT-Image-2，按张提交且使用 DragonCode 超时', async () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DRAGONCODE_TASK_TIMEOUT_MS = '180000'
    process.env.DRAGONCODE_INITIAL_POLL_DELAY_MS = '8000'
    process.env.QWEN_IMAGE_TASK_TIMEOUT_MS = '120000'
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async () => jsonResponse(submitSuccess),
    )
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000301'), rt)
    expect(created.bundle.job).toMatchObject({
      provider: 'dragoncode',
      model_profile_id: 'dragoncode:gpt-image-2',
      requested_count: 2,
      credits_reserved: 12,
    })
    expect(created.bundle.job.provider_params).toMatchObject({ n: 1, size: '16:9', resolution: '2k' })
    expect(created.bundle.job.provider_params.batch).toBeUndefined()
    expect(new Date(created.bundle.job.deadline_at).getTime() - rt.now()).toBe(180_000)
    expect(new Date(created.bundle.job.next_poll_at).getTime() - rt.now()).toBe(8_000)
    await applySubmits(store, created, rt)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    for (const call of fetchImpl.mock.calls) {
      expect(JSON.parse(String(call[1]?.body)).n).toBe(1)
      expect(String(call[0])).toContain('/images/generations')
    }
  })

  it('千问一次请求 n 张，少返回的张数失败并只结算成功张数', async () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DRAGONCODE_TASK_TIMEOUT_MS = '400000'
    process.env.QWEN_IMAGE_TASK_TIMEOUT_MS = '120000'
    process.env.QWEN_IMAGE_INITIAL_POLL_DELAY_MS = '7000'
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/image-generation/generation')) return jsonResponse(submitPending)
      if (url.includes('/tasks/')) return jsonResponse(pollSucceededContentImages(3))
      return new Response(MOCK_PNG_1X1, { status: 200, headers: { 'Content-Type': 'image/png' } })
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000302', 4, 'bailian:qwen-image-3.0'), rt)
    expect(created.bundle.job).toMatchObject({
      provider: 'bailian',
      model_profile_id: 'bailian:qwen-image-3.0',
      requested_count: 4,
      credits_reserved: 12,
    })
    expect(created.bundle.job.provider_params).toMatchObject({ size: '2688*1536', resolution: '2k', n: 4, batch: true })
    expect(new Date(created.bundle.job.deadline_at).getTime() - rt.now()).toBe(120_000)
    expect(new Date(created.bundle.job.next_poll_at).getTime() - rt.now()).toBe(7_000)
    const items = await applySubmits(store, created, rt)
    expect(items.map(item => item.provider_task_id)).toEqual(['qwen-task-fixture-001', 'qwen-task-fixture-001', 'qwen-task-fixture-001', 'qwen-task-fixture-001'])
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).includes('/image-generation/generation'))).toHaveLength(1)
    const advanced = await advanceJobInStore(store, {
      job: { ...created.bundle.job, next_poll_at: new Date(0) },
      items,
    }, rt, { alreadyLeased: true })
    expect(advanced.job.status).toBe('succeeded')
    expect(advanced.items.map(item => item.status)).toEqual(['succeeded', 'succeeded', 'succeeded', 'failed'])
    expect(advanced.items[3].error_message).toBe('图片服务返回的图片数量不足')
    expect(advanced.items.slice(0, 3).map(item => item.result_object_key)).toEqual([
      expect.stringMatching(/\/0\.png$/),
      expect.stringMatching(/\/1\.png$/),
      expect.stringMatching(/\/2\.png$/),
    ])
    expect(rt.billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 9 })
    expect(rt.billing.release).not.toHaveBeenCalled()
    expect(fetchImpl.mock.calls.filter(call => String(call[0]).includes('/tasks/'))).toHaveLength(1)
    expect(fetchImpl.mock.calls.filter(call => String(call[0]) === qwenImageUrl(0))).toHaveLength(1)
    expect(rt.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'bailian-usage', outputImageCount: 3, outputImageType: 'qima_output_2k',
      imageShape: 'choices-content-image', submitTime: QWEN_SUBMIT_TIME, scheduledTime: QWEN_SCHEDULED_TIME,
      endTime: QWEN_END_TIME, cost: 0.54, currency: 'CNY', enableThinking: false,
    }))
    expect(advanced.job.provider_params.vendor).toMatchObject({
      cost: 0.54,
      currency: 'CNY',
      items: { '0': { output_image_count: 3, output_image_type: 'qima_output_2k', cost: 0.54, currency: 'CNY', image_shape: 'choices-content-image' } },
    })
    expect(advanced.job.provider_params.vendor).not.toMatchObject({ items: { '1': expect.anything() } })
  })

  it('千问内容审核拒绝整单退款，超时未完成也退款', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    const moderationFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/tasks/')) return jsonResponse(pollFailedModeration)
      return jsonResponse(submitPending)
    })
    const rt = runtime(moderationFetch)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000303', 2, 'bailian:qwen-image-3.0-pro'), rt)
    expect(created.bundle.job.credits_reserved).toBe(16)
    const items = await applySubmits(store, created, rt)
    const rejected = await advanceJobInStore(store, { job: { ...created.bundle.job, next_poll_at: new Date(0) }, items }, rt, { alreadyLeased: true })
    expect(rejected.job.status).toBe('failed')
    expect(rejected.items.every(item => item.error_code === 'CONTENT_REJECTED' && item.error_message === '内容未通过审核')).toBe(true)
    expect(rt.billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(rt.billing.settle).not.toHaveBeenCalled()

    const slowFetch = vi.fn(async (input: RequestInfo | URL) => {
      return String(input).includes('/tasks/') ? jsonResponse(pollRunning) : jsonResponse(submitPending)
    })
    const slow = runtime(slowFetch)
    const slowStore = createMemoryStore(user.id)
    const pending = await createImageJobInStore(slowStore, user, text('00000000-0000-4000-8000-000000000304', 1, 'bailian:qwen-image-3.0'), slow)
    const pendingItems = await applySubmits(slowStore, pending, slow)
    slow.setNow(new Date(pending.bundle.job.deadline_at).getTime() + 1)
    const expired = await advanceJobInStore(slowStore, {
      job: { ...pending.bundle.job, next_poll_at: new Date(0) },
      items: pendingItems,
    }, slow, { alreadyLeased: true })
    expect(expired.job.status).toBe('expired')
    expect(slow.billing.release).toHaveBeenCalledWith(pending.bundle.job.id)
    expect(slow.billing.settle).not.toHaveBeenCalled()
  })

  it('千问不接受 4K，Pro 1K 按 4 分预扣', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    const rt = runtime(vi.fn(async () => jsonResponse({})))
    const store = createMemoryStore(user.id)
    const fourK = createImageTaskSchema.parse({
      capability: 'text_to_image',
      requestId: '00000000-0000-4000-8000-000000000306',
      modelProfileId: 'bailian:qwen-image-3.0',
      params: { prompt: '海报', size: { width: 1024, height: 1024 }, count: 1, resolution: '4k' },
    })
    await expect(createImageJobInStore(store, user, fourK, rt)).rejects.toMatchObject({
      status: 400, code: 'INVALID_PARAMS', message: '当前模型不支持所选分辨率，请重新选择',
    })
    expect(rt.billing.reserve).not.toHaveBeenCalled()
    const pro = createImageTaskSchema.parse({
      capability: 'text_to_image',
      requestId: '00000000-0000-4000-8000-000000000307',
      modelProfileId: 'bailian:qwen-image-3.0-pro',
      params: { prompt: '海报', size: { width: 1024, height: 1024 }, count: 1, resolution: '1k' },
    })
    const created = await createImageJobInStore(store, user, pro, rt)
    expect(created.bundle.job.credits_reserved).toBe(4)
    expect(created.bundle.job.provider_params).toMatchObject({ size: '1328*1328', resolution: '1k', n: 1, batch: true, enableThinking: false })
  })

  it('千问把自动扩写写入供应商参数和上游请求，积分不因开关变化', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    delete process.env.QWEN_IMAGE_THINKING
    delete process.env.QWEN_IMAGE_PROMPT_EXTEND
    const bodies: string[] = []
    const fetchImpl = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async (input, init) => {
      const url = String(input)
      if (url.includes('/image-generation/generation')) {
        bodies.push(String(init?.body ?? ''))
        return jsonResponse(submitPending)
      }
      return jsonResponse(pollRunning)
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const on = createImageTaskSchema.parse({
      capability: 'text_to_image',
      requestId: '00000000-0000-4000-8000-000000000309',
      modelProfileId: 'bailian:qwen-image-3.0',
      params: { prompt: '海报', size: { width: 1024, height: 1024 }, count: 1, resolution: '1k', enableThinking: true },
    })
    const created = await createImageJobInStore(store, user, on, rt)
    expect(created.bundle.job.credits_reserved).toBe(3)
    expect(created.bundle.job.provider_params.enableThinking).toBe(true)
    await applySubmits(store, created, rt)
    expect(JSON.parse(bodies[0]).parameters).toMatchObject({ prompt_extend: true, enable_thinking: true })
    expect(rt.log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'qwen-image-submit', enableThinking: true }))

    process.env.QWEN_IMAGE_THINKING = 'false'
    const forced = createImageTaskSchema.parse({
      ...on,
      requestId: '00000000-0000-4000-8000-000000000310',
    })
    const overridden = await createImageJobInStore(store, user, forced, rt)
    expect(overridden.bundle.job.credits_reserved).toBe(3)
    expect(overridden.bundle.job.provider_params.enableThinking).toBe(false)
    expect(overridden.bundle.job.params).toMatchObject({ enableThinking: true })
  })

  it('开关关闭时不能选千问模型', async () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.QWEN_IMAGE_ENABLED
    const rt = runtime(vi.fn(async () => jsonResponse({})))
    await expect(createImageJobInStore(
      createMemoryStore(user.id), user, text('00000000-0000-4000-8000-000000000305', 1, 'bailian:qwen-image-3.0'), rt,
    )).rejects.toMatchObject({ status: 503, code: 'TEXT_TO_IMAGE_UNAVAILABLE' })
    expect(rt.billing.reserve).not.toHaveBeenCalled()
  })

  it('建连失败不退款，下一轮轮询再提交；连接重置则失败退款', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_REQUEST_RETRY_COUNT = '0'
    delete process.env.DRAGONCODE_API_KEY
    const connectTimeout = new TypeError('fetch failed', {
      cause: Object.assign(new Error('Connect Timeout Error'), { code: 'UND_ERR_CONNECT_TIMEOUT', name: 'ConnectTimeoutError' }),
    })
    let submits = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/image-generation/generation')) {
        submits += 1
        if (submits === 1) throw connectTimeout
        return jsonResponse(submitPending)
      }
      return jsonResponse(pollRunning)
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000308', 2, 'bailian:qwen-image-3.0-pro'), rt)
    const scheduled = created.bundle.job.next_poll_at
    const pendingItems = await applySubmits(store, created, rt)
    expect(pendingItems.map(item => item.status)).toEqual(['pending', 'pending'])
    expect(pendingItems.every(item => item.provider_task_id == null)).toBe(true)
    const held = await finalizeJob(store, created.bundle.job, pendingItems, rt, false, [], { keepScheduledPoll: true })
    expect(held.job.status).toBe('queued')
    expect(held.job.billing_state).toBe('reserved')
    expect(held.job.next_poll_at).toEqual(scheduled)
    expect(rt.billing.release).not.toHaveBeenCalled()
    const retried = await advanceJobInStore(store, {
      job: { ...held.job, next_poll_at: new Date(0) },
      items: held.items,
    }, rt, { alreadyLeased: true })
    expect(retried.items.map(item => item.provider_task_id)).toEqual(['qwen-task-fixture-001', 'qwen-task-fixture-001'])
    expect(submits).toBe(2)

    const reset = new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) })
    const resetRt = runtime(vi.fn(async () => { throw reset }))
    const resetStore = createMemoryStore(user.id)
    const resetCreated = await createImageJobInStore(resetStore, user, text('00000000-0000-4000-8000-000000000309', 1, 'bailian:qwen-image-3.0'), resetRt)
    const failedItems = await applySubmits(resetStore, resetCreated, resetRt)
    const failed = await finalizeJob(resetStore, resetCreated.bundle.job, failedItems, resetRt, false)
    expect(failed.job.status).toBe('failed')
    expect(failed.items[0].error_message).toBe('文生图服务连接失败，请稍后重试')
    expect(resetRt.billing.release).toHaveBeenCalledWith(resetCreated.bundle.job.id)
  })

  it('多张结果并行下载', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    let imageStarts = 0
    let release: () => void = () => undefined
    const bothStarted = new Promise<void>(resolve => { release = resolve })
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/image-generation/generation')) return jsonResponse(submitPending)
      if (url.includes('/tasks/')) return jsonResponse(pollSucceededContentImages(2))
      imageStarts += 1
      if (imageStarts === 2) release()
      await bothStarted
      return new Response(MOCK_PNG_1X1, { status: 200, headers: { 'Content-Type': 'image/png' } })
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000310', 2, 'bailian:qwen-image-3.0'), rt)
    const items = await applySubmits(store, created, rt)
    const advanced = await Promise.race([
      advanceJobInStore(store, { job: { ...created.bundle.job, next_poll_at: new Date(0) }, items }, rt, { alreadyLeased: true }),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('downloads did not overlap')), 500)),
    ])
    expect(imageStarts).toBe(2)
    expect(advanced.items.map(item => item.status)).toEqual(['succeeded', 'succeeded'])
  })

  it('千问瞬时限流保持排队，退避后重新提交且不重复建单', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_REQUEST_RETRY_COUNT = '2'
    delete process.env.DRAGONCODE_API_KEY
    let submits = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/image-generation/generation')) {
        submits += 1
        if (submits === 1) return jsonResponse(submitThrottled, 429)
        return jsonResponse(submitPending)
      }
      return jsonResponse(pollRunning)
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000401', 2, 'bailian:qwen-image-3.0-pro'), rt)
    const pendingItems = await applySubmits(store, created, rt)
    expect(pendingItems.map(item => item.status)).toEqual(['pending', 'pending'])
    expect(pendingItems.every(item => item.provider_task_id == null && item.error_code === 'RATE_LIMIT')).toBe(true)
    expect(submits).toBe(1)
    expect(rt.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'qwen-image-submit', upstreamCode: 'Throttling.RateQuota',
    }))
    const held = await finalizeJob(store, created.bundle.job, pendingItems, rt, false, [], { keepScheduledPoll: true })
    expect(held.job.status).toBe('queued')
    expect(held.job.billing_state).toBe('reserved')
    expect(rt.billing.release).not.toHaveBeenCalled()
    expect(new Date(held.job.next_poll_at).getTime() - rt.now()).toBe(15_000)
    await expect(toClientImageTask(held, rt)).resolves.toMatchObject({ status: 'queued', errorMessage: undefined })
    const early = await advanceJobInStore(store, held, rt)
    expect(early.job.status).toBe('queued')
    expect(submits).toBe(1)
    rt.setNow(new Date(held.job.next_poll_at).getTime())
    const retried = await advanceJobInStore(store, {
      job: { ...held.job, next_poll_at: new Date(rt.now()) },
      items: held.items,
    }, rt)
    expect(retried.items.map(item => item.provider_task_id)).toEqual(['qwen-task-fixture-001', 'qwen-task-fixture-001'])
    expect(retried.items.every(item => item.error_code == null)).toBe(true)
    expect(submits).toBe(2)
  })

  it('千问限流直到截止则全额退款，并说明积分已退回', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.QWEN_IMAGE_REQUEST_RETRY_COUNT = '2'
    delete process.env.DRAGONCODE_API_KEY
    let submits = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/image-generation/generation')) submits += 1
      return jsonResponse(submitThrottled, 429)
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000402', 1, 'bailian:qwen-image-3.0'), rt)
    const pendingItems = await applySubmits(store, created, rt)
    const held = await finalizeJob(store, created.bundle.job, pendingItems, rt, false, [], { keepScheduledPoll: true })
    expect(held.job.billing_state).toBe('reserved')
    expect(new Date(held.job.next_poll_at).getTime() - rt.now()).toBe(8_000)
    rt.setNow(new Date(held.job.deadline_at).getTime() + 1)
    const expired = await advanceJobInStore(store, {
      job: { ...held.job, next_poll_at: new Date(0) },
      items: held.items,
    }, rt, { alreadyLeased: true })
    expect(submits).toBe(1)
    expect(expired.job).toMatchObject({
      status: 'expired',
      error_code: 'RATE_LIMIT',
      error_message: QWEN_THROTTLE_REFUND_MESSAGE,
      billing_state: 'released',
      credits_charged: 0,
    })
    expect(rt.billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(rt.billing.settle).not.toHaveBeenCalled()
    await expect(toClientImageTask(expired, rt)).resolves.toMatchObject({
      status: 'failed',
      errorMessage: QWEN_THROTTLE_REFUND_MESSAGE,
    })
  })

  it('AllocationQuota 立即失败并退款，不再提交', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    const fetchImpl = vi.fn(async () => jsonResponse({
      code: 'Throttling.AllocationQuota',
      message: 'Free allocated quota exceeded.',
    }, 429))
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000403', 1, 'bailian:qwen-image-3.0-pro'), rt)
    expect(rt.billing.reserve).toHaveBeenCalledTimes(1)
    const items = await applySubmits(store, created, rt)
    const failed = await finalizeJob(store, created.bundle.job, items, rt, false)
    expect(failed.job.status).toBe('failed')
    expect(failed.items[0]).toMatchObject({ status: 'failed', error_message: QWEN_QUOTA_EXHAUSTED_MESSAGE })
    expect(rt.billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await advanceJobInStore(store, { job: { ...failed.job, next_poll_at: new Date(0) }, items: failed.items }, rt, { alreadyLeased: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('查询 429 不把已提交的千问任务判失败', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    let polls = 0
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).includes('/image-generation/generation')) return jsonResponse(submitPending)
      polls += 1
      return jsonResponse(submitThrottled, 429)
    })
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000404', 1, 'bailian:qwen-image-3.0'), rt)
    const items = await applySubmits(store, created, rt)
    const advanced = await advanceJobInStore(store, {
      job: { ...created.bundle.job, next_poll_at: new Date(0) },
      items,
    }, rt, { alreadyLeased: true })
    expect(polls).toBe(1)
    expect(advanced.job.status).toBe('processing')
    expect(advanced.items[0].status).toBe('submitted')
    expect(rt.billing.release).not.toHaveBeenCalled()
  })

  it('Pro 和百炼并发上限在预扣前返回 429，GPT Image 2 不受影响', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.QWEN_IMAGE_PRO_ACTIVE_LIMIT = '1'
    process.env.QWEN_IMAGE_ACTIVE_LIMIT = '8'
    const rt = runtime(vi.fn(async () => jsonResponse({})), Date.now())
    const store = createMemoryStore(user.id)
    await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000405', 1, 'bailian:qwen-image-3.0-pro'), rt)
    await expect(createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000406', 1, 'bailian:qwen-image-3.0-pro'), rt))
      .rejects.toMatchObject({ status: 429, code: 'MODEL_CONCURRENCY', message: QWEN_QUEUE_FULL_MESSAGE })
    expect(rt.billing.reserve).toHaveBeenCalledTimes(1)
    const standard = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000407', 1, 'bailian:qwen-image-3.0'), rt)
    expect(standard.bundle.job.provider).toBe('bailian')
    expect(rt.billing.reserve).toHaveBeenCalledTimes(2)
    const wideStore = createMemoryStore(user.id)
    await createImageJobInStore(wideStore, user, text('00000000-0000-4000-8000-000000000412', 1, 'bailian:qwen-image-3.0-pro'), rt)
    const wide = await createImageJobInStore(wideStore, user, text('00000000-0000-4000-8000-000000000413', 1, 'bailian:qwen-image-2.1-pro'), rt)
    expect(wide.bundle.job.model_profile_id).toBe('bailian:qwen-image-2.1-pro')

    process.env.QWEN_IMAGE_ACTIVE_LIMIT = '1'
    const capped = createMemoryStore(user.id)
    const cappedRt = runtime(vi.fn(async () => jsonResponse({})), Date.now())
    await createImageJobInStore(capped, user, text('00000000-0000-4000-8000-000000000408', 1, 'bailian:qwen-image-3.0'), cappedRt)
    await expect(createImageJobInStore(capped, user, text('00000000-0000-4000-8000-000000000409', 1, 'bailian:qwen-image-3.0'), cappedRt))
      .rejects.toMatchObject({ status: 429, code: 'PROVIDER_CONCURRENCY', message: QWEN_QUEUE_FULL_MESSAGE })
    expect(cappedRt.billing.reserve).toHaveBeenCalledTimes(1)
    const gpt = await createImageJobInStore(capped, user, text('00000000-0000-4000-8000-000000000410', 1), cappedRt)
    expect(gpt.bundle.job).toMatchObject({ provider: 'dragoncode', model_profile_id: 'dragoncode:gpt-image-2' })
    expect(cappedRt.billing.reserve).toHaveBeenCalledTimes(2)
  })

  it('千问编辑和融合把参考图放在文字前，不按输入图加积分', async () => {
    process.env.QWEN_IMAGE_ENABLED = 'true'
    process.env.DASHSCOPE_API_KEY = 'sk-dash'
    delete process.env.DRAGONCODE_API_KEY
    const fetchImpl = vi.fn(async () => jsonResponse(submitPending))
    const rt = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, createImageTaskSchema.parse({
      capability: 'image_edit',
      requestId: '00000000-0000-4000-8000-000000000411',
      modelProfileId: 'bailian:qwen-image-3.0',
      params: {
        prompt: '换成白底',
        sourceImageKey: `temporary/task-inputs/${user.id}/product.png`,
        referenceImageKey: `temporary/task-inputs/${user.id}/scene.png`,
        count: 1,
        resolution: '1k',
        size: { width: 1024, height: 1024 },
      },
    }), rt)
    expect(created.bundle.job.credits_reserved).toBe(3)
    await applySubmits(store, created, rt)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.model).toBe('qwen-image-3.0')
    expect(body.input.messages[0].content).toEqual([
      { image: `https://r2.test/temporary/task-inputs/${user.id}/product.png` },
      { image: `https://r2.test/temporary/task-inputs/${user.id}/scene.png` },
      { text: expect.stringContaining('换成白底') },
    ])
    expect(body.parameters).not.toHaveProperty('prompt_extend_mode')
  })
})
