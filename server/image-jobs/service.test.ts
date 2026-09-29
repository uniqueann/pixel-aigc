import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FUSION_FIXED_PROMPT, FUSION_NOTE_MAX, composeFusionPrompt, fusionNoteLimitMessage } from '../../shared/fusion.js'
import { RETOUCH_FIXED_PROMPT, RETOUCH_NOTE_MAX, composeRetouchPrompt, retouchNoteLimitMessage } from '../../shared/retouch.js'
import { VARIATION_FIXED_PROMPT, VARIATION_USER_PROMPT_MAX, composeVariationPrompt, variationPromptLimitMessage } from '../../shared/variation.js'
import { mapDragonCodeRequest } from '../image-providers/dragoncode/mapping.js'
import { MOCK_PNG_1X1, createMockImageProvider } from '../image-providers/mock.js'
import { createMemoryStore } from './memory-store.js'
import {
  IMAGE_LEASE_MS,
  advanceJobInStore,
  assertFusionRequest,
  assertRetouchNoteLimit,
  assertVariationSteerLimit,
  createImageJobInStore,
  createImageTaskSchema,
  finalizeJob,
  runProviderSubmits,
  toClientImageTask,
} from './service.js'
import { LATE_RESULT_WARNING, PARTIAL_WARNING, nextPollAt, reduceJobStatus, toClientTaskStatus } from './state.js'
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

  it('首次轮询 5s，之后至少 3s', () => {
    expect(nextPollAt(0, 5_000, true).getTime()).toBe(5_000)
    expect(nextPollAt(0, 5_000).getTime()).toBe(5_000)
    expect(nextPollAt(0, 2_000).getTime()).toBe(3_000)
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

  it('把上游 cost / credits_cost 写入已有 provider_params JSON', async () => {
    const store = createMemoryStore(user.id)
    const rt = runtime(createMockImageProvider({
      async getStatus() {
        return {
          state: 'succeeded',
          resultUrls: ['https://mock.local/a.png'],
          vendor: { cost: 0.0085, creditsCost: 1, expiresAt: 1_759_116_436 },
        }
      },
    }))
    const created = await createImageJobInStore(store, user, params(), rt)
    await store.updateItem(created.bundle.job.id, 0, { status: 'submitted', provider_task_id: 't-cost' })
    const advanced = await advanceJobInStore(store, {
      job: { ...created.bundle.job, next_poll_at: new Date(0) },
      items: await store.listItems(created.bundle.job.id),
    }, rt, { alreadyLeased: true })
    expect(advanced.job.provider_params.vendor).toEqual({
      cost: 0.0085,
      credits_cost: 1,
      items: { '0': { cost: 0.0085, credits_cost: 1, expires_at: 1_759_116_436 } },
    })
    expect(rt.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'dragoncode-usage', cost: 0.0085, creditsCost: 1,
    }))
  })

  it('客户端任务带上 resultImages.objectKey，供同域下载', async () => {
    const store = createMemoryStore(user.id)
    const rt = runtime(createMockImageProvider({
      async getStatus() { return { state: 'succeeded', resultUrls: ['https://mock.local/a.png'] } },
    }))
    const created = await createImageJobInStore(store, user, params(), rt)
    await store.updateItem(created.bundle.job.id, 0, { status: 'submitted', provider_task_id: 't-1' })
    const advanced = await advanceJobInStore(store, {
      job: { ...created.bundle.job, next_poll_at: new Date(0) },
      items: await store.listItems(created.bundle.job.id),
    }, rt)
    const client = await toClientImageTask(advanced, rt)
    expect(client.resultImages?.[0]?.objectKey).toMatch(/^generated\//)
    expect(client.resultImages?.[0]?.objectKey).toBe(advanced.items[0].result_object_key)
  })
})

function variationParams(overrides: Record<string, unknown> = {}) {
  return {
    capability: 'variation' as const,
    requestId: '00000000-0000-4000-8000-000000000202',
    params: {
      sourceImageKey: sourceKey,
      count: 2,
      resolution: '2k' as const,
      sourceWidth: 1200,
      sourceHeight: 800,
      ...overrides,
    },
  }
}

describe('裂变任务', () => {
  it('智能编辑仍拒绝空提示词，裂变允许省略提示词', () => {
    expect(() => createImageTaskSchema.parse(params({ prompt: '  ' }))).toThrow()
    expect(createImageTaskSchema.parse(variationParams()).capability).toBe('variation')
  })

  it('空补充要求使用固定句，用户原文仍留在任务参数里', async () => {
    const store = createMemoryStore(user.id)
    const submit = vi.fn(async () => ({ providerTaskId: 'variation-1' }))
    const provider = createMockImageProvider({ submit })
    const rt = runtime(provider)
    const created = await createImageJobInStore(store, user, variationParams({ prompt: '只换背景' }), rt)
    expect(created.bundle.job.capability).toBe('variation')
    expect(created.bundle.job.params).toMatchObject({ prompt: '只换背景', count: 2 })
    expect(created.bundle.job.provider_params.prompt).toBe(composeVariationPrompt('只换背景'))
    expect(String(created.bundle.job.provider_params.prompt).startsWith(VARIATION_FIXED_PROMPT)).toBe(true)
    await runProviderSubmits(created.bundle, provider, user.id, rt)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: composeVariationPrompt('只换背景'),
    }), expect.anything())

    const plain = await createImageJobInStore(createMemoryStore(user.id), user, variationParams(), rt)
    expect(plain.bundle.job.provider_params.prompt).toBe(VARIATION_FIXED_PROMPT)
    expect(plain.bundle.job.params).not.toHaveProperty('prompt')
  })

  it('超过用户字数上限时返回明确上限', () => {
    const prompt = '景'.repeat(VARIATION_USER_PROMPT_MAX + 1)
    expect(() => assertVariationSteerLimit(variationParams({ prompt }))).toThrow(variationPromptLimitMessage())
    expect(() => createImageTaskSchema.parse(variationParams({ prompt }))).toThrow()
  })

  it('不支持 4K 的比例仍降到 2K', async () => {
    const store = createMemoryStore(user.id)
    const mock = createMockImageProvider()
    const provider = { ...mock, mapRequest: mapDragonCodeRequest }
    const rt = runtime(provider)
    const created = await createImageJobInStore(store, user, variationParams({
      resolution: '4k',
      sourceWidth: 1000,
      sourceHeight: 1000,
    }), rt)
    expect(created.bundle.job.provider_params.resolution).toBe('2k')
    expect(created.bundle.job.warnings).toContain('RESOLUTION_DOWNGRADED_4K_UNSUPPORTED_RATIO')
  })

  it('未配置模型时拒绝裂变', async () => {
    delete process.env.DRAGONCODE_API_KEY
    await expect(createImageJobInStore(createMemoryStore(user.id), user, variationParams(), runtime()))
      .rejects.toMatchObject({ status: 503, message: '裂变尚未配置可用的图片模型', code: 'VARIATION_UNAVAILABLE' })
  })
})

describe('精修任务', () => {
  it('不选方向时智能编辑仍拒绝空提示词', () => {
    expect(() => createImageTaskSchema.parse(params({ prompt: '  ' }))).toThrow()
    expect(createImageTaskSchema.parse(params()).params).toMatchObject({ prompt: '换成白底' })
  })

  it('选中方向后拼固定句，未选方向不出现，补充说明不能盖掉约束', async () => {
    const store = createMemoryStore(user.id)
    const submit = vi.fn(async () => ({ providerTaskId: 'retouch-1' }))
    const provider = createMockImageProvider({ submit })
    const rt = runtime(provider)
    const created = await createImageJobInStore(store, user, params({
      prompt: '保留金属拉丝',
      retouchDirections: ['sharpen', 'blemish', 'sharpen'],
      count: 1,
    }), rt)
    const composed = composeRetouchPrompt(['blemish', 'sharpen'], '保留金属拉丝')
    expect(created.bundle.job.capability).toBe('image_edit')
    expect(created.bundle.job.params).toMatchObject({
      prompt: '保留金属拉丝',
      retouchDirections: ['blemish', 'sharpen'],
      count: 1,
    })
    expect(created.bundle.job.provider_params.prompt).toBe(composed)
    expect(String(created.bundle.job.provider_params.prompt).endsWith(RETOUCH_FIXED_PROMPT)).toBe(true)
    expect(String(created.bundle.job.provider_params.prompt).indexOf('保留金属拉丝'))
      .toBeLessThan(String(created.bundle.job.provider_params.prompt).indexOf(RETOUCH_FIXED_PROMPT))
    expect(String(created.bundle.job.provider_params.prompt)).not.toContain('提亮：')
    await runProviderSubmits(created.bundle, provider, user.id, rt)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: composed }), expect.anything())

    const plain = await createImageJobInStore(createMemoryStore(user.id), user, params({
      prompt: undefined,
      retouchDirections: ['brighten'],
    }), rt)
    expect(plain.bundle.job.provider_params.prompt).toBe(composeRetouchPrompt(['brighten']))
    expect(plain.bundle.job.params).not.toHaveProperty('prompt')
    const parsed = createImageTaskSchema.parse(params({
      prompt: undefined,
      retouchDirections: ['texture'],
    }))
    expect(parsed.capability === 'image_edit' && parsed.params.retouchDirections).toEqual(['texture'])
  })

  it('补充说明超过上限时返回明确字数', () => {
    const prompt = '字'.repeat(RETOUCH_NOTE_MAX + 1)
    const body = params({ prompt, retouchDirections: ['blemish'] })
    expect(() => assertRetouchNoteLimit(body)).toThrow(retouchNoteLimitMessage())
    expect(() => createImageTaskSchema.parse(body)).toThrow()
  })
})

describe('融合任务', () => {
  const sceneKey = `temporary/task-inputs/${user.id}/scene-1`

  it('场景图按商品图在前的顺序提交，裁切尺寸仍是商品图', async () => {
    const store = createMemoryStore(user.id)
    const submit = vi.fn(async () => ({ providerTaskId: 'fusion-1' }))
    const provider = createMockImageProvider({ submit })
    const rt = runtime(provider)
    const created = await createImageJobInStore(store, user, params({
      prompt: '放在桌面中央',
      referenceImageKey: sceneKey,
      sourceWidth: 1200,
      sourceHeight: 800,
      count: 1,
    }), rt)
    const composed = composeFusionPrompt('放在桌面中央')
    expect(created.bundle.job.capability).toBe('image_edit')
    expect(created.bundle.job.params).toMatchObject({
      sourceImageKey: sourceKey,
      referenceImageKey: sceneKey,
      sourceWidth: 1200,
      sourceHeight: 800,
      prompt: '放在桌面中央',
    })
    expect(created.bundle.job.provider_params.prompt).toBe(composed)
    expect(String(created.bundle.job.provider_params.prompt).startsWith(FUSION_FIXED_PROMPT)).toBe(true)
    await runProviderSubmits(created.bundle, provider, user.id, rt)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({
      prompt: composed,
      images: [
        { url: `https://r2.test/${sourceKey}` },
        { url: `https://r2.test/${sceneKey}` },
      ],
    }), expect.anything())
  })

  it('拒绝同一张图、别人的对象，以及过长的补充说明', async () => {
    const rt = runtime()
    await expect(createImageJobInStore(createMemoryStore(user.id), user, params({
      referenceImageKey: sourceKey,
    }), rt)).rejects.toMatchObject({ code: 'INVALID_SOURCE', message: '商品图和场景图不能是同一张' })
    await expect(createImageJobInStore(createMemoryStore(user.id), user, params({
      referenceImageKey: 'temporary/task-inputs/other-user/scene',
    }), rt)).rejects.toMatchObject({ code: 'INVALID_SOURCE', message: '场景图对象无效或无权访问' })
    const prompt = '字'.repeat(FUSION_NOTE_MAX + 1)
    const body = params({ prompt, referenceImageKey: sceneKey })
    expect(() => assertFusionRequest(body)).toThrow(fusionNoteLimitMessage())
    expect(createImageTaskSchema.parse(params({ prompt: '  ', referenceImageKey: sceneKey })).capability).toBe('image_edit')
    expect(() => createImageTaskSchema.parse(params({ prompt: '  ' }))).toThrow()
  })
})
