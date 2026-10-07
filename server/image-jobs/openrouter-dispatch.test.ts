import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_NANO_BANANA_PROFILE_ID } from '../../shared/image-models.js'
import { createOpenRouterImageProvider, type OpenRouterResultStore } from '../image-providers/openrouter/client.js'
import { openRouterImageSettings } from '../image-providers/openrouter/config.js'
import { MOCK_PNG_1X1 } from '../image-providers/mock.js'
import { imageProviderById } from '../image-providers/registry.js'
import { createMemoryStore } from './memory-store.js'
import {
  createImageJobInStore,
  createImageTaskSchema,
  finishSubmittedImageJob,
  type ImageJobRuntime,
} from './service.js'

const user = { id: '00000000-0000-4000-8000-000000000001', email: 'alice@example.com', suggestedName: 'A', avatarUrl: null, providers: ['email'] }
const KEYS = ['OPENROUTER_API_KEY', 'OPENROUTER_IMAGE_ENABLED', 'DRAGONCODE_API_KEY', 'QWEN_IMAGE_ENABLED'] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
const png = Buffer.from(MOCK_PNG_1X1).toString('base64')

function memoryResultStore(): OpenRouterResultStore {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  return {
    async putObject(key, bytes, contentType) {
      objects.set(key, { bytes: Uint8Array.from(bytes), contentType })
    },
    async getObject(key) {
      return objects.get(key)
    },
  }
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

function imageBody(cost?: number) {
  return {
    choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${png}` } }] } }],
    usage: {
      prompt_tokens: 8,
      completion_tokens: 1120,
      total_tokens: 1128,
      ...(cost === undefined ? {} : { cost }),
    },
  }
}

function runtime(fetchImpl: typeof fetch, provider = createOpenRouterImageProvider(openRouterImageSettings, memoryResultStore())) {
  const billing = {
    reserve: vi.fn(async () => ({ ok: true as const })),
    settle: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
  const rt = {
    now: () => Date.parse('2026-10-07T00:00:00.000Z'),
    sleep: async () => undefined,
    fetch: fetchImpl,
    log: vi.fn(),
    signRead: vi.fn(async (key: string) => ({ url: `https://r2.test/${key}`, expiresAt: Date.parse('2026-10-07T01:00:00.000Z') })),
    getObject: vi.fn(async () => ({ bytes: MOCK_PNG_1X1, contentType: 'image/png' })),
    putObject: vi.fn(async () => undefined),
    billing,
    crop: async (bytes: Uint8Array) => ({ bytes: new Uint8Array(bytes), width: 1024, height: 1024, mimeType: 'image/png', cropped: false }),
    providerFor: (id: string) => id === 'openrouter' ? provider : imageProviderById(id),
  } satisfies ImageJobRuntime
  return { rt, billing, provider }
}

function text(requestId: string, count: number, resolution: '1k' | '2k' | '4k') {
  return createImageTaskSchema.parse({
    capability: 'text_to_image',
    requestId,
    modelProfileId: OPENROUTER_NANO_BANANA_PROFILE_ID,
    params: {
      prompt: '橙色香水瓶置于浅色木桌',
      size: { width: 1024, height: 1024 },
      count,
      resolution,
    },
  })
}

afterEach(() => {
  for (const key of KEYS) {
    const value = previous[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('OpenRouter Nano Banana 任务', () => {
  it('未配置 Key 时不预扣', async () => {
    delete process.env.OPENROUTER_API_KEY
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    delete process.env.DRAGONCODE_API_KEY
    const { rt, billing } = runtime(vi.fn())
    await expect(createImageJobInStore(
      createMemoryStore(user.id), user, text('00000000-0000-4000-8000-000000000911', 1, '1k'), rt,
    )).rejects.toMatchObject({ status: 503, code: 'TEXT_TO_IMAGE_UNAVAILABLE' })
    expect(billing.reserve).not.toHaveBeenCalled()
  })

  it('按 1K 单价预扣，成功后记录 usage，没有上游成本时用目录价', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imageBody()))
    const { rt, billing, provider } = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000912', 1, '1k'), rt)
    expect(created.bundle.job).toMatchObject({
      provider: 'openrouter',
      model_profile_id: OPENROUTER_NANO_BANANA_PROFILE_ID,
      credits_reserved: 4,
      requested_count: 1,
    })
    expect(created.bundle.job.provider_params).toMatchObject({
      aspectRatio: '1:1', imageSize: '1K', resolution: '1k', n: 1,
    })
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({ status: 'succeeded', billing_state: 'settled', credits_charged: 4 })
    expect(billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 4 })
    expect(billing.release).not.toHaveBeenCalled()
    expect(finished.job.provider_params.vendor).toMatchObject({
      cost: 0.039359,
      currency: 'USD',
      items: {
        '0': {
          cost: 0.039359,
          currency: 'USD',
          prompt_tokens: 8,
          completion_tokens: 1120,
          total_tokens: 1128,
          output_image_count: 1,
        },
      },
    })
    expect(rt.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'openrouter-usage',
      promptTokens: 8,
      completionTokens: 1120,
      totalTokens: 1128,
      cost: 0.039359,
      currency: 'USD',
    }))
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.modalities).toEqual(['image', 'text'])
    expect(body.image_config).toEqual({ aspect_ratio: '1:1', image_size: '1K' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('上游失败全额退还，不按目录价结算', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ error: { message: 'upstream down' } }, 502))
    const { rt, billing, provider } = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000913', 2, '4k'), rt)
    expect(created.bundle.job.credits_reserved).toBe(28)
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({ status: 'failed', billing_state: 'released', credits_charged: 0 })
    expect(finished.items.every(item => item.status === 'failed')).toBe(true)
    expect(billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(billing.settle).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('余额不足失败并退还预扣', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ error: { message: 'Insufficient credits' } }, 402))
    const { rt, billing, provider } = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000915', 1, '2k'), rt)
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({
      status: 'failed', billing_state: 'released', credits_charged: 0, error_code: 'INSUFFICIENT_BALANCE',
      error_message: '图片服务余额不足',
    })
    expect(finished.items[0]).toMatchObject({
      status: 'failed', error_code: 'INSUFFICIENT_BALANCE', error_message: '图片服务余额不足',
    })
    expect(billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(billing.settle).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('参考图不额外加价，2K 两张只预扣 12', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-test-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imageBody(0.0504)))
    const provider = createOpenRouterImageProvider(() => ({ ...openRouterImageSettings()!, maxParallel: 1 }), memoryResultStore())
    const { rt, billing } = runtime(fetchImpl, provider)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, createImageTaskSchema.parse({
      capability: 'image_edit',
      requestId: '00000000-0000-4000-8000-000000000914',
      modelProfileId: OPENROUTER_NANO_BANANA_PROFILE_ID,
      params: {
        sourceImageKey: `temporary/task-inputs/${user.id}/source-1`,
        prompt: '换成白底',
        count: 2,
        resolution: '2k',
        sourceWidth: 1200,
        sourceHeight: 800,
      },
    }), rt)
    expect(created.bundle.job.credits_reserved).toBe(12)
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({ status: 'succeeded', credits_charged: 12 })
    expect(billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 12 })
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.image_config).toEqual({ aspect_ratio: '3:2', image_size: '2K' })
    expect(body.messages[0].content[1]).toEqual({
      type: 'image_url',
      image_url: { url: `https://r2.test/temporary/task-inputs/${user.id}/source-1` },
    })
    expect(body).not.toHaveProperty('plugins')
    expect(JSON.stringify(body)).not.toContain('web_search')
  })
})
