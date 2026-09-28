import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MOCK_PNG_1X1, createMockImageProvider } from '../image-providers/mock.js'
import { createMemoryStore } from './memory-store.js'
import {
  IMAGE_LEASE_MS,
  advanceJobInStore,
  createImageJobInStore,
  finalizeJob,
  runProviderSubmits,
} from './service.js'
import { LATE_RESULT_WARNING, PARTIAL_WARNING, reduceJobStatus, toClientTaskStatus } from './state.js'
import type { ImageJobRuntime } from './service.js'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
const requestId = '00000000-0000-4000-8000-000000000201'
const sourceKey = `temporary/task-inputs/${user.id}/source-1`

function params(overrides: Record<string, unknown> = {}) {
  return {
    capability: 'image_edit' as const,
    requestId,
    params: {
      sourceImageKey: sourceKey,
      prompt: '换成白底',
      count: 1,
      resolution: '2k' as const,
      sourceWidth: 1200,
      sourceHeight: 800,
      ...overrides,
    },
  }
}

function billingSpy() {
  return {
    reserve: vi.fn(async () => ({ ok: true as const })),
    settle: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
}

function runtime(provider = createMockImageProvider(), billing = billingSpy()): ImageJobRuntime & { billing: ReturnType<typeof billingSpy> } {
  return {
    now: () => Date.parse('2026-09-28T00:00:00.000Z'),
    sleep: async () => undefined,
    fetch: vi.fn() as unknown as typeof fetch,
    log: vi.fn(),
    signRead: async (key) => ({ url: `https://r2.test/${key}`, expiresAt: Date.now() + 900000 }),
    putObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => ({ bytes: MOCK_PNG_1X1, contentType: 'image/png' })),
    billing,
    crop: async (bytes) => ({ bytes: new Uint8Array(bytes), width: 8, height: 8, mimeType: 'image/png', cropped: false }),
    providerFor: () => provider,
  }
}

const originalKey = process.env.DRAGONCODE_API_KEY
const originalScope = process.env.AIGC_RUNTIME_SCOPE

beforeEach(() => {
  process.env.DRAGONCODE_API_KEY = 'test-key'
  process.env.AIGC_RUNTIME_SCOPE = 'local'
})

afterEach(() => {
  if (originalKey === undefined) delete process.env.DRAGONCODE_API_KEY
  else process.env.DRAGONCODE_API_KEY = originalKey
  if (originalScope === undefined) delete process.env.AIGC_RUNTIME_SCOPE
  else process.env.AIGC_RUNTIME_SCOPE = originalScope
})

describe('图片任务状态机', () => {
  it('至少一张成功且其余终态时为 succeeded + PARTIAL', () => {
    expect(reduceJobStatus([
      { status: 'succeeded' }, { status: 'succeeded' }, { status: 'succeeded' }, { status: 'failed' },
    ], 1, 10)).toEqual({ status: 'succeeded', warnings: [PARTIAL_WARNING] })
  })

  it('全部失败为 failed，超时无结果为 expired', () => {
    expect(reduceJobStatus([{ status: 'failed' }, { status: 'failed' }], 1, 10)).toEqual({ status: 'failed', warnings: [] })
    expect(reduceJobStatus([{ status: 'expired' }, { status: 'expired' }], 20, 10)).toEqual({ status: 'expired', warnings: [] })
  })

  it('expired 对前端映射为 failed + TASK_TIMEOUT', () => {
    expect(toClientTaskStatus('expired')).toEqual({
      status: 'failed', errorCode: 'TASK_TIMEOUT', errorMessage: '任务处理超时，请重试',
    })
  })
})

describe('图片任务存储状态机', () => {
  it('同一 requestId 幂等，fingerprint 不同则 409', async () => {
    const store = createMemoryStore(user.id)
    const rt = runtime()
    const first = await createImageJobInStore(store, user, params(), rt)
    const again = await createImageJobInStore(store, user, params(), rt)
    expect(again.created).toBe(false)
    expect(again.bundle.job.id).toBe(first.bundle.job.id)
    await expect(createImageJobInStore(store, user, params({ prompt: '另一句' }), rt))
      .rejects.toMatchObject({ code: 'REQUEST_CONFLICT', status: 409 })
  })

  it('扇出 4 张时 3 成功 1 失败则部分成功并按成功张数结算', async () => {
    const store = createMemoryStore(user.id)
    const billing = billingSpy()
    const statuses = ['succeeded', 'succeeded', 'succeeded', 'failed'] as const
    let index = 0
    const provider = createMockImageProvider({
      async submit() { return { providerTaskId: `t-${index++}` } },
      async getStatus(id) {
        const ordinal = Number(String(id).slice(2))
        return statuses[ordinal] === 'failed'
          ? { state: 'failed', code: 'UNKNOWN', message: '上游失败', retryable: false }
          : { state: 'succeeded', resultUrls: [`https://mock.local/${id}.png`] }
      },
    })
    const rt = runtime(provider, billing)
    rt.now = () => Date.parse('2026-09-28T00:00:00.000Z')
    const created = await createImageJobInStore(store, user, params({ count: 4 }), rt)
    expect(created.bundle.items).toHaveLength(4)
    const outcomes = await runProviderSubmits(created.bundle, provider, user.id, rt)
    for (const outcome of outcomes) await store.updateItem(created.bundle.job.id, outcome.ordinal, outcome.patch)
    const items = await store.listItems(created.bundle.job.id)
    const advanced = await advanceJobInStore(store, { job: { ...created.bundle.job, next_poll_at: new Date(0) }, items }, rt, { alreadyLeased: true })
    expect(advanced.job.status).toBe('succeeded')
    expect(advanced.job.warnings).toContain(PARTIAL_WARNING)
    expect(advanced.items.filter(item => item.status === 'succeeded')).toHaveLength(3)
    expect(billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 0 })
    expect(billing.release).not.toHaveBeenCalled()
  })

  it('全部失败则 failed 并全额退回', async () => {
    const store = createMemoryStore(user.id)
    const billing = billingSpy()
    const { ProviderError } = await import('../image-providers/types.js')
    const rt = runtime(createMockImageProvider({
      async submit() { throw new ProviderError('UNKNOWN', '失败') },
    }), billing)
    const created = await createImageJobInStore(store, user, params({ count: 2 }), rt)
    const outcomes = await runProviderSubmits(created.bundle, rt.providerFor('mock')!, user.id, rt)
    const items = []
    for (const outcome of outcomes) items.push(await store.updateItem(created.bundle.job.id, outcome.ordinal, outcome.patch))
    const finalized = await finalizeJob(store, created.bundle.job, items, rt, false)
    expect(finalized.job.status).toBe('failed')
    expect(billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(billing.settle).not.toHaveBeenCalled()
  })

  it('超过 deadline 且无结果则为 expired 并退回', async () => {
    const store = createMemoryStore(user.id)
    const billing = billingSpy()
    const rt = runtime(createMockImageProvider({
      async getStatus() { return { state: 'processing', raw: 'pending' } },
    }), billing)
    const created = await createImageJobInStore(store, user, params(), rt)
    await store.updateItem(created.bundle.job.id, 0, { status: 'submitted', provider_task_id: 'late-1' })
    rt.now = () => Date.parse('2026-09-28T01:00:00.000Z')
    const items = await store.listItems(created.bundle.job.id)
    const advanced = await advanceJobInStore(store, {
      job: { ...created.bundle.job, deadline_at: new Date('2026-09-28T00:01:00.000Z'), next_poll_at: new Date(0) },
      items,
    }, rt, { alreadyLeased: true })
    expect(advanced.job.status).toBe('expired')
    expect(billing.release).toHaveBeenCalledWith(created.bundle.job.id)
  })

  it('超时后上游才完成则交付但不扣费', async () => {
    const store = createMemoryStore(user.id)
    const billing = billingSpy()
    const rt = runtime(createMockImageProvider({
      async getStatus() { return { state: 'succeeded', resultUrls: ['https://mock.local/late.png'] } },
    }), billing)
    const created = await createImageJobInStore(store, user, params(), rt)
    await store.updateItem(created.bundle.job.id, 0, { status: 'expired', provider_task_id: 'late-1' })
    const expired = await store.updateJob(created.bundle.job.id, {
      status: 'expired', billing_state: 'released', deadline_at: new Date('2026-09-28T00:01:00.000Z'), next_poll_at: new Date(0),
    })
    rt.now = () => Date.parse('2026-09-28T00:02:00.000Z')
    const advanced = await advanceJobInStore(store, {
      job: expired,
      items: await store.listItems(created.bundle.job.id),
    }, rt, { alreadyLeased: true })
    expect(advanced.job.status).toBe('succeeded')
    expect(advanced.job.warnings).toContain(LATE_RESULT_WARNING)
    expect(advanced.items[0].result_object_key).toMatch(/^generated\//)
    expect(billing.settle).not.toHaveBeenCalled()
  })

  it('并发推进只有一个拿到租约，不会重复下载', async () => {
    const store = createMemoryStore(user.id)
    const fetchResult = vi.fn(async () => ({ bytes: MOCK_PNG_1X1, mimeType: 'image/png' }))
    const rt = runtime(createMockImageProvider({
      async getStatus() { return { state: 'succeeded', resultUrls: ['https://mock.local/a.png'] } },
      fetchResult,
    }))
    const created = await createImageJobInStore(store, user, params(), rt)
    await store.updateItem(created.bundle.job.id, 0, { status: 'submitted', provider_task_id: 't-1' })
    const job = { ...created.bundle.job, next_poll_at: new Date(0) }
    const items = await store.listItems(job.id)
    const first = advanceJobInStore(store, { job, items }, rt)
    const second = advanceJobInStore(store, { job, items }, rt)
    const [a, b] = await Promise.all([first, second])
    const winners = [a, b].filter(bundle => bundle.items[0]?.result_object_key)
    expect(winners).toHaveLength(1)
    expect(fetchResult).toHaveBeenCalledTimes(1)
    expect(IMAGE_LEASE_MS).toBe(30_000)
  })
})
