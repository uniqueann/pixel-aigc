import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mapDragonCodeRequest } from '../image-providers/dragoncode/mapping.js'
import { createMockImageProvider, MOCK_PNG_1X1 } from '../image-providers/mock.js'
import { ProviderError, type ImageProvider } from '../image-providers/types.js'
import * as modelRegistry from '../image-providers/registry.js'
import { IMAGE_MODEL_PROFILES } from '../../shared/image-models.js'
import { createMemoryStore } from './memory-store.js'
import {
  advanceJobInStore, createImageJobInStore, createImageTaskSchema, finalizeJob,
  runProviderSubmits, toClientImageTask, type ImageJobRuntime,
} from './service.js'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
const requestId = '00000000-0000-4000-8000-000000000203'
function payload(overrides: Record<string, unknown> = {}) {
  return { capability: 'text_to_image' as const, requestId, params: {
    prompt: '橙色香水瓶置于浅色木桌', size: { width: 1600, height: 900 }, count: 2,
    resolution: '2k' as const, ...overrides,
  } }
}
function runtime(provider = createMockImageProvider()) {
  const rt: ImageJobRuntime = {
    now: () => Date.parse('2026-10-03T00:00:00Z'), sleep: async () => undefined,
    fetch: vi.fn() as unknown as typeof fetch, log: vi.fn(),
    signRead: vi.fn(async key => ({ url: `https://r2.test/${key}`, expiresAt: 9999999999999 })),
    getObject: vi.fn(async () => ({ bytes: MOCK_PNG_1X1, contentType: 'image/png' })),
    putObject: vi.fn(async () => undefined),
    billing: { reserve: vi.fn(async () => ({ ok: true as const })), settle: vi.fn(async () => undefined), release: vi.fn(async () => undefined) },
    crop: vi.fn(async (bytes, width, height) => ({ bytes, width, height, mimeType: 'image/png', cropped: false })),
    providerFor: () => provider,
  }
  return rt
}
function mappedProvider(options?: Parameters<typeof createMockImageProvider>[0]): ImageProvider {
  return { ...createMockImageProvider(options), mapRequest: mapDragonCodeRequest }
}
beforeEach(() => vi.stubEnv('DRAGONCODE_API_KEY', 'test-key'))
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

describe('真实文生图任务', () => {
  it('不需要原图，描述去首尾空白；拒绝空描述、超过上限与原图字段', () => {
    expect(createImageTaskSchema.parse(payload({ prompt: '  香水瓶  ' })).params).toMatchObject({ prompt: '香水瓶' })
    for (const invalid of [
      { prompt: '  ' }, { prompt: '字'.repeat(3501) }, { sourceImageKey: 'media/other/source' },
      { sourceImageUrl: 'https://external.test/source.png' }, { count: 5 },
      { size: { width: 0, height: 900 } }, { resolution: '8k' },
    ]) expect(createImageTaskSchema.safeParse(payload(invalid)).success).toBe(false)
    expect(createImageTaskSchema.safeParse(payload({ prompt: '字'.repeat(3500) })).success).toBe(true)
    expect(createImageTaskSchema.safeParse(payload({ enableThinking: true })).success).toBe(true)
    expect(createImageTaskSchema.safeParse(payload({ enableThinking: false })).success).toBe(true)
    expect(createImageTaskSchema.safeParse(payload({ enableThinking: 'true' })).success).toBe(false)
  })

  it('提交扇出为空参考图并映射目标比例，不读取或签发输入对象', async () => {
    const submit = vi.fn(async () => ({ providerTaskId: 'text-image-task' }))
    const provider = mappedProvider({ submit })
    const rt = runtime(provider)
    const created = await createImageJobInStore(createMemoryStore(user.id), user, createImageTaskSchema.parse(payload()), rt)
    expect(created.bundle.job).toMatchObject({ capability: 'text_to_image', credits_reserved: 6, requested_count: 2 })
    expect(created.bundle.job.provider_params).toMatchObject({ size: '16:9', resolution: '2k', n: 1 })
    expect(created.bundle.job.params).not.toHaveProperty('sourceImageKey')
    await runProviderSubmits(created.bundle, provider, user.id, rt)
    expect(submit).toHaveBeenCalledTimes(2)
    expect(submit).toHaveBeenCalledWith(expect.objectContaining({ prompt: payload().params.prompt, images: [] }), expect.anything())
    expect(rt.signRead).not.toHaveBeenCalled()
    expect(rt.getObject).not.toHaveBeenCalled()
    expect(rt.billing.reserve).toHaveBeenCalledWith(expect.objectContaining({ amount: 6, meta: expect.objectContaining({ capability: 'text_to_image' }) }))
  })

  it('GPT Image 2 接受思考开关但不写入供应商参数，积分与关闭时相同', async () => {
    const rt = runtime(mappedProvider())
    const created = await createImageJobInStore(createMemoryStore(user.id), user, createImageTaskSchema.parse(payload({ enableThinking: true })), rt)
    expect(created.bundle.job.params).toMatchObject({ enableThinking: true })
    expect(created.bundle.job.provider_params).not.toHaveProperty('enableThinking')
    expect(created.bundle.job.credits_reserved).toBe(6)
    const off = await createImageJobInStore(createMemoryStore(user.id), user, createImageTaskSchema.parse({
      ...payload({ enableThinking: false }),
      requestId: '00000000-0000-4000-8000-000000000204',
    }), rt)
    expect(off.bundle.job.credits_reserved).toBe(created.bundle.job.credits_reserved)
  })

  it('4K 不支持目标比例时降到 2K 并按有效价格预扣', async () => {
    const rt = runtime(mappedProvider())
    const created = await createImageJobInStore(createMemoryStore(user.id), user, createImageTaskSchema.parse(payload({
      size: { width: 1024, height: 1024 }, resolution: '4k', count: 4,
    })), rt)
    expect(created.bundle.job.provider_params).toMatchObject({ size: '1:1', resolution: '2k' })
    expect(created.bundle.job.warnings).toContain('RESOLUTION_DOWNGRADED_4K_UNSUPPORTED_RATIO')
    expect(created.bundle.job.credits_reserved).toBe(12)
  })

  it('拒绝模型未开放的分辨率，且不预扣或创建任务', async () => {
    const profile = IMAGE_MODEL_PROFILES[0]
    vi.spyOn(modelRegistry, 'configuredImageModels').mockReturnValue([
      { ...profile, ui: { ...profile.ui, resolutions: ['2k'] } },
    ])
    const store = createMemoryStore(user.id)
    const rt = runtime(mappedProvider())
    await expect(createImageJobInStore(store, user, createImageTaskSchema.parse(payload({ resolution: '1k' })), rt))
      .rejects.toMatchObject({ status: 400, code: 'INVALID_PARAMS', message: '当前模型不支持所选分辨率，请重新选择' })
    expect(rt.billing.reserve).not.toHaveBeenCalled()
    expect(await store.findByRequestId(requestId)).toBeUndefined()
  })

  it('相同请求只预扣一次，改描述或尺寸复用请求号返回冲突', async () => {
    const store = createMemoryStore(user.id)
    const rt = runtime()
    const parsed = createImageTaskSchema.parse(payload())
    const first = await createImageJobInStore(store, user, parsed, rt)
    const again = await createImageJobInStore(store, user, parsed, rt)
    expect(again.created).toBe(false)
    expect(again.bundle.job.id).toBe(first.bundle.job.id)
    expect(rt.billing.reserve).toHaveBeenCalledTimes(1)
    for (const overrides of [{ prompt: '新的描述' }, { size: { width: 900, height: 1600 } }])
      await expect(createImageJobInStore(store, user, createImageTaskSchema.parse(payload(overrides)), rt))
        .rejects.toMatchObject({ status: 409, code: 'REQUEST_CONFLICT' })
  })

  it('未配置模型和积分不足均不创建文生图任务', async () => {
    vi.stubEnv('DRAGONCODE_API_KEY', '')
    const store = createMemoryStore(user.id)
    const rt = runtime()
    await expect(createImageJobInStore(store, user, createImageTaskSchema.parse(payload()), rt))
      .rejects.toMatchObject({ status: 503, code: 'TEXT_TO_IMAGE_UNAVAILABLE', message: '文生图尚未配置可用的图片模型' })
    expect(rt.billing.reserve).not.toHaveBeenCalled()
    vi.stubEnv('DRAGONCODE_API_KEY', 'test-key')
    rt.billing.reserve = vi.fn(async () => ({ ok: false as const, code: 'INSUFFICIENT_CREDITS' as const, message: '余额不足', required: 6, balance: 0 }))
    await expect(createImageJobInStore(store, user, createImageTaskSchema.parse(payload()), rt))
      .rejects.toMatchObject({ status: 402, code: 'INSUFFICIENT_CREDITS' })
    expect(await store.findByRequestId(requestId)).toBeUndefined()
  })

  it('部分成功按实际序号返回对象与尺寸，裁剪使用请求比例并仅结算成功张数', async () => {
    let index = 0
    const provider = mappedProvider({
      submit: async () => ({ providerTaskId: `text-${index++}` }),
      getStatus: async id => id === 'text-0'
        ? { state: 'failed', code: 'CONTENT_REJECTED', message: '描述需要调整', retryable: false }
        : { state: 'succeeded', resultUrls: [`https://mock.local/${id}.png`] },
    })
    const store = createMemoryStore(user.id)
    const rt = runtime(provider)
    const created = await createImageJobInStore(store, user, createImageTaskSchema.parse(payload()), rt)
    for (const outcome of await runProviderSubmits(created.bundle, provider, user.id, rt))
      await store.updateItem(created.bundle.job.id, outcome.ordinal, outcome.patch)
    const advanced = await advanceJobInStore(store, { job: { ...created.bundle.job, next_poll_at: new Date(0) }, items: await store.listItems(created.bundle.job.id) }, rt)
    const client = await toClientImageTask(advanced, rt)
    expect(client).toMatchObject({ capability: 'text_to_image', status: 'succeeded', creditsCost: 3, warnings: ['PARTIAL'] })
    expect(client.resultImages).toEqual([expect.objectContaining({ ordinal: 1, width: 1600, height: 900, objectKey: expect.stringMatching(/\/1\.png$/) })])
    expect(rt.crop).toHaveBeenCalledWith(MOCK_PNG_1X1, 1600, 900)
    expect(rt.billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 3 })
    expect(rt.billing.release).not.toHaveBeenCalled()
  })

  it('上游提交失败时任务层不追加提交并全额退款', async () => {
    const submit = vi.fn(async () => { throw new ProviderError('UPSTREAM_UNAVAILABLE', '上游不可用', true) })
    const provider = mappedProvider({ submit })
    const store = createMemoryStore(user.id)
    const rt = runtime(provider)
    const created = await createImageJobInStore(store, user, createImageTaskSchema.parse(payload()), rt)
    const items = []
    for (const outcome of await runProviderSubmits(created.bundle, provider, user.id, rt))
      items.push(await store.updateItem(created.bundle.job.id, outcome.ordinal, outcome.patch))
    const result = await finalizeJob(store, created.bundle.job, items, rt, false)
    expect(result.job.status).toBe('failed')
    expect(submit).toHaveBeenCalledTimes(2)
    expect(rt.billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(rt.billing.settle).not.toHaveBeenCalled()
  })
})
