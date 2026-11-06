import { afterEach, describe, expect, it, vi } from 'vitest'
import { GPT_IMAGE_26_PROFILE_ID } from '../../shared/image-models.js'
import { createAiGatewayImageProvider, type AiGatewayResultStore } from '../image-providers/ai-gateway/client.js'
import { aiGatewayGptImageSettings, aiGatewayImageSettings } from '../image-providers/ai-gateway/config.js'
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
  'AI_GATEWAY_API_KEY', 'AI_GATEWAY_IMAGE_ENABLED', 'AI_GATEWAY_GPT_IMAGE_ENABLED', 'VERCEL', 'VERCEL_OIDC_TOKEN',
  'OPENROUTER_API_KEY', 'OPENROUTER_IMAGE_ENABLED', 'DRAGONCODE_API_KEY',
] as const
const previous = Object.fromEntries(KEYS.map(key => [key, process.env[key]]))
const png = Buffer.from(MOCK_PNG_1X1).toString('base64')

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

function imagesBody(usage?: Record<string, unknown>) {
  return {
    output_format: 'png',
    data: [{ b64_json: png }],
    ...(usage ? { usage } : {}),
  }
}

function runtime(fetchImpl: typeof fetch) {
  const provider = createAiGatewayImageProvider(
    aiGatewayImageSettings,
    memoryResultStore(),
    async () => 'oidc-test-token',
    aiGatewayGptImageSettings,
  )
  const billing = {
    reserve: vi.fn(async () => ({ ok: true as const })),
    settle: vi.fn(async () => undefined),
    release: vi.fn(async () => undefined),
  }
  const rt = {
    now: () => Date.parse('2026-11-06T00:00:00.000Z'),
    sleep: async () => undefined,
    fetch: fetchImpl,
    log: vi.fn(),
    signRead: vi.fn(async (key: string) => ({ url: `https://r2.test/${key}`, expiresAt: Date.parse('2026-11-06T01:00:00.000Z') })),
    getObject: vi.fn(async () => ({ bytes: MOCK_PNG_1X1, contentType: 'image/png' })),
    putObject: vi.fn(async () => undefined),
    billing,
    crop: async (bytes: Uint8Array) => ({ bytes: new Uint8Array(bytes), width: 1024, height: 1024, mimeType: 'image/png', cropped: false }),
    providerFor: (id: string) => id === 'ai-gateway' ? provider : imageProviderById(id),
  } satisfies ImageJobRuntime
  return { rt, billing, provider }
}

function text(requestId: string, count: number, resolution: '1k' | '2k' | '4k', modelProfileId?: string) {
  return createImageTaskSchema.parse({
    capability: 'text_to_image',
    requestId,
    ...(modelProfileId ? { modelProfileId } : {}),
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

describe('AI Gateway GPT Image 2.6 任务', () => {
  it('开关关闭时不能选这个模型，不传模型仍走 DragonCode', async () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    delete process.env.AI_GATEWAY_GPT_IMAGE_ENABLED
    const { rt } = runtime(vi.fn())
    const store = createMemoryStore(user.id)
    await expect(createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000931', 1, '1k', GPT_IMAGE_26_PROFILE_ID), rt))
      .rejects.toMatchObject({ status: 503 })
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000932', 1, '1k'), rt)
    expect(created.bundle.job).toMatchObject({
      provider: 'dragoncode',
      model_profile_id: 'dragoncode:gpt-image-2',
      credits_reserved: 4,
    })
  })

  it('文生图走 images/generations，记下 usage.cost，预扣按 8/16/28', async () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_GPT_IMAGE_ENABLED = 'true'
    process.env.AI_GATEWAY_IMAGE_ENABLED = 'true'
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagesBody({
      input_tokens: 100, output_tokens: 1756, total_tokens: 1856, cost: 0.061,
    })))
    const { rt, billing, provider } = runtime(fetchImpl)
    const store = createMemoryStore(user.id)
    const created = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000933', 1, '1k', GPT_IMAGE_26_PROFILE_ID), rt)
    expect(created.bundle.job).toMatchObject({
      provider: 'ai-gateway',
      model_profile_id: GPT_IMAGE_26_PROFILE_ID,
      credits_reserved: 8,
    })
    expect(created.bundle.job.provider_params).toMatchObject({
      model: 'openai/gpt-image-2.6-flare',
      size: '1024x1024',
      quality: 'medium',
      resolution: '1k',
    })
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job).toMatchObject({ status: 'succeeded', billing_state: 'settled', credits_charged: 8 })
    expect(billing.settle).toHaveBeenCalledWith({ jobId: created.bundle.job.id, charged: 8 })
    expect(finished.job.provider_params.vendor).toMatchObject({ cost: 0.061, currency: 'USD' })
    expect(String(fetchImpl.mock.calls[0][0])).toBe('https://ai-gateway.vercel.sh/v1/images/generations')
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('chat/completions')
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body).toMatchObject({ model: 'openai/gpt-image-2.6-flare', size: '1024x1024', quality: 'medium', n: 1 })
    expect(body).not.toHaveProperty('modalities')
    expect(body).not.toHaveProperty('providerOptions')

    const fourK = await createImageJobInStore(store, user, text('00000000-0000-4000-8000-000000000934', 1, '4k', GPT_IMAGE_26_PROFILE_ID), rt)
    expect(fourK.bundle.job.credits_reserved).toBe(28)
    expect(fourK.bundle.job.provider_params.size).toBe('2880x2880')
  })

  it('编辑走 images/edits；没有 cost 时用 token，连 token 都没有时用目录价', async () => {
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_GPT_IMAGE_ENABLED = 'true'
    const tokenFetch = vi.fn().mockImplementation(async () => jsonResponse(imagesBody({
      input_tokens: 100, output_tokens: 1756, total_tokens: 1856,
    })))
    const { rt, provider } = runtime(tokenFetch)
    const store = createMemoryStore(user.id)
    const edit = createImageTaskSchema.parse({
      capability: 'image_edit',
      requestId: '00000000-0000-4000-8000-000000000935',
      modelProfileId: GPT_IMAGE_26_PROFILE_ID,
      params: {
        sourceImageKey: `temporary/task-inputs/${user.id}/source-1`,
        prompt: '换成白底',
        count: 1,
        resolution: '2k',
        sourceWidth: 1200,
        sourceHeight: 800,
      },
    })
    const created = await createImageJobInStore(store, user, edit, rt)
    expect(created.bundle.job.credits_reserved).toBe(16)
    expect(created.bundle.job.provider_params).toMatchObject({ size: '2048x1360', quality: 'medium' })
    const outcomes = await (await import('./service.js')).runProviderSubmits(created.bundle, provider, user.id, rt)
    const finished = await finishSubmittedImageJob(store, created.bundle, outcomes, rt, provider)
    expect(finished.job.provider_params.vendor).toMatchObject({ cost: 0.05318, currency: 'USD' })
    expect(String(tokenFetch.mock.calls[0][0])).toBe('https://ai-gateway.vercel.sh/v1/images/edits')
    const body = JSON.parse(String(tokenFetch.mock.calls[0][1]?.body))
    expect(body.images).toEqual([{ image_url: `https://r2.test/temporary/task-inputs/${user.id}/source-1` }])
    expect(body).not.toHaveProperty('modalities')

    const bare = vi.fn().mockImplementation(async () => jsonResponse(imagesBody()))
    const bareRuntime = runtime(bare)
    const bareStore = createMemoryStore(user.id)
    const fallback = await createImageJobInStore(bareStore, user, text('00000000-0000-4000-8000-000000000936', 1, '1k', GPT_IMAGE_26_PROFILE_ID), bareRuntime.rt)
    const fallbackOutcomes = await (await import('./service.js')).runProviderSubmits(fallback.bundle, bareRuntime.provider, user.id, bareRuntime.rt)
    const priced = await finishSubmittedImageJob(bareStore, fallback.bundle, fallbackOutcomes, bareRuntime.rt, bareRuntime.provider)
    expect(priced.job.provider_params.vendor).toMatchObject({ cost: 0.09, currency: 'USD' })
  })

  it('不传 modelProfileId 时文生图、编辑和裂变仍默认 DragonCode', async () => {
    process.env.DRAGONCODE_API_KEY = 'sk-dragon'
    process.env.AI_GATEWAY_API_KEY = 'gw-test-key'
    process.env.AI_GATEWAY_GPT_IMAGE_ENABLED = 'true'
    const { rt } = runtime(vi.fn())
    const textJob = await createImageJobInStore(createMemoryStore(user.id), user, text('00000000-0000-4000-8000-000000000937', 1, '2k'), rt)
    expect(textJob.bundle.job.model_profile_id).toBe('dragoncode:gpt-image-2')
    expect(textJob.bundle.job.credits_reserved).toBe(6)
    const edit = await createImageJobInStore(createMemoryStore(user.id), user, createImageTaskSchema.parse({
      capability: 'image_edit',
      requestId: '00000000-0000-4000-8000-000000000938',
      params: {
        sourceImageKey: `temporary/task-inputs/${user.id}/source-1`,
        prompt: '换成白底',
        count: 1,
        resolution: '1k',
      },
    }), rt)
    expect(edit.bundle.job).toMatchObject({ model_profile_id: 'dragoncode:gpt-image-2', provider: 'dragoncode', credits_reserved: 4 })
    const variation = await createImageJobInStore(createMemoryStore(user.id), user, createImageTaskSchema.parse({
      capability: 'variation',
      requestId: '00000000-0000-4000-8000-000000000939',
      params: {
        sourceImageKey: `temporary/task-inputs/${user.id}/source-1`,
        count: 1,
        resolution: '4k',
        sourceWidth: 1920,
        sourceHeight: 1080,
      },
    }), rt)
    expect(variation.bundle.job).toMatchObject({ model_profile_id: 'dragoncode:gpt-image-2', credits_reserved: 14 })
  })
})
