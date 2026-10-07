import { afterEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_NANO_BANANA_PROFILE_ID } from '../../shared/image-models.js'
import { createAiGatewayImageProvider, type AiGatewayResultStore } from '../image-providers/ai-gateway/client.js'
import { aiGatewayImageSettings } from '../image-providers/ai-gateway/config.js'
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
const KEYS = [
  'AI_GATEWAY_API_KEY', 'AI_GATEWAY_IMAGE_ENABLED', 'VERCEL', 'VERCEL_OIDC_TOKEN',
  'OPENROUTER_API_KEY', 'OPENROUTER_IMAGE_ENABLED', 'DRAGONCODE_API_KEY',
] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
const jpeg = Buffer.from(MOCK_PNG_1X1).toString('base64')

function memoryResultStore(): AiGatewayResultStore {
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
    choices: [{ message: { images: [{ image_url: { url: `data:image/jpeg;base64,${jpeg}` } }] } }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 1400,
      total_tokens: 1420,
      ...(cost === undefined ? {} : { cost }),
    },
  }
}

function runtime(fetchImpl: typeof fetch) {
  const provider = createAiGatewayImageProvider(aiGatewayImageSettings, memoryResultStore(), async () => 'oidc-test-token')
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
    crop: async (bytes: Uint8Array) => ({ bytes: new Uint8Array(bytes), width: 1024, height: 1024, mimeType: 'image/jpeg', cropped: false }),
    providerFor: (id: string) => id === 'ai-gateway' ? provider : imageProviderById(id),
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

describe('AI Gateway Nano Banana 任务', () => {
  it('开关打开后走 AI Gateway，成功时记下 usage.cost', async () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    process.env.OPENROUTER_API_KEY = 'sk-test-openrouter'
    process.env.OPENROUTER_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imageBody(0.0393585)))
    const { rt, billing, provider } = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000921', 1, '1k'), rt)
    expect(created.bundle.job).toMatchObject({
      provider: 'ai-gateway',
      model_profile_id: OPENROUTER_NANO_BANANA_PROFILE_ID,
      credits_reserved: 4,
    })
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({ status: 'succeeded', billing_state: 'settled', credits_charged: 4 })
    expect(billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 4 })
    expect(billing.release).not.toHaveBeenCalled()
    expect(finished.job.provider_params.vendor).toMatchObject({
      cost: 0.0393585,
      currency: 'USD',
      items: { '0': { cost: 0.0393585, currency: 'USD', prompt_tokens: 20 } },
    })
    expect(rt.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'ai-gateway-usage',
      cost: 0.0393585,
      currency: 'USD',
    }))
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.providerOptions.google.imageConfig).toEqual({ aspectRatio: '1:1', imageSize: '1K' })
    expect(body.providerOptions.vertex.imageConfig).toEqual({ aspectRatio: '1:1', imageSize: '1K' })
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://ai-gateway.vercel.sh/v1/chat/completions')
  })

  it('没有上游成本时用目录价，失败时全额退还', async () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    const missingCost = vi.fn().mockImplementation(async () => jsonResponse(imageBody()))
    const { rt, billing, provider } = runtime(missingCost)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000922', 1, '1k'), rt)
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job.provider_params.vendor).toMatchObject({ cost: 0.039359, currency: 'USD' })

    const denied = vi.fn().mockImplementation(async () => jsonResponse({
      error: { message: 'Free tier users do not have access to this model.', type: 'no_providers_available' },
    }, 403))
    const failedRuntime = runtime(denied)
    const failedStore = createMemoryStore(user.id)
    const failed = await createImageJobInStore(failedStore, user, text('00000000-0000-4000-8000-000000000923', 2, '4k'), failedRuntime.rt)
    expect(failed.bundle.job.credits_reserved).toBe(28)
    const failedOutcomes = await (await import('./service.js')).runProviderSubmits(failed.bundle, failedRuntime.provider, user.id, failedRuntime.rt)
    const released = await finishSubmittedImageJob(failedStore, failed.bundle, failedOutcomes, failedRuntime.rt, failedRuntime.provider)
    expect(released.job).toMatchObject({
      status: 'failed', billing_state: 'released', credits_charged: 0, error_code: 'INSUFFICIENT_BALANCE',
    })
    expect(failedRuntime.billing.release).toHaveBeenCalledWith(failed.bundle.job.id)
    expect(failedRuntime.billing.settle).not.toHaveBeenCalled()
    expect(billing.settle).toHaveBeenCalledTimes(1)
  })

  it('权限类失败也全额退还预扣', async () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({
      error: { message: 'AI Gateway requires a valid credit card on file.', type: 'customer_verification_required' },
    }, 403))
    const { rt, billing, provider } = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000924', 1, '2k'), rt)
    expect(created.bundle.job.credits_reserved).toBe(6)
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({
      status: 'failed', billing_state: 'released', credits_charged: 0, error_code: 'PROVIDER_FORBIDDEN',
      error_message: '图片服务暂不可用（上游权限限制）',
    })
    expect(billing.release).toHaveBeenCalledWith(created.bundle.job.id)
    expect(billing.settle).not.toHaveBeenCalled()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
