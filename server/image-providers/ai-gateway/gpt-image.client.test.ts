import { describe, expect, it, vi } from 'vitest'
import { GPT_IMAGE_26_MODEL } from '../../../shared/image-models.js'
import { MOCK_PNG_1X1 } from '../mock.js'
import { createAiGatewayImageProvider, type AiGatewayResultStore } from './client.js'
import type { AiGatewayImageSettings } from './config.js'
import { decodeAiGatewayTask } from './response.js'

const settings: AiGatewayImageSettings = {
  apiKey: 'gw-test-key',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  model: GPT_IMAGE_26_MODEL,
  requestTimeoutMs: 1_000,
  taskTimeoutMs: 300_000,
  pollIntervalMs: 2_000,
  initialPollDelayMs: 130_000,
  maxParallel: 4,
}

const png = Buffer.from(MOCK_PNG_1X1).toString('base64')

function memoryStore(): AiGatewayResultStore {
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

function provider() {
  return createAiGatewayImageProvider(() => null, memoryStore(), vi.fn(), () => settings)
}

function context(fetchImpl: typeof fetch) {
  return {
    fetch: fetchImpl,
    sleep: async () => undefined,
    now: () => 1_000,
    log: vi.fn(),
    requestId: '00000000-0000-4000-8000-000000000931',
  }
}

const input = {
  model: GPT_IMAGE_26_MODEL,
  prompt: '橙色香水瓶',
  images: [] as Array<{ url: string }>,
  providerParams: { size: '1024x1024', resolution: '1k', quality: 'medium', n: 1 },
  ordinal: 0,
}

describe('AI Gateway GPT Image 2.6 客户端', () => {
  it('文生图打 images/generations，记下 usage.cost，不走 chat completions', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({
      data: [{ b64_json: png }],
      usage: { input_tokens: 20, output_tokens: 1449, total_tokens: 1469, cost: 0.0501 },
    }))
    const ctx = context(fetchImpl)
    const gpt = provider()
    const submitted = await gpt.submit!(input, ctx)
    expect(fetchImpl.mock.calls[0][0]).toBe('https://ai-gateway.vercel.sh/v1/images/generations')
    expect(String(fetchImpl.mock.calls[0][0])).not.toContain('chat/completions')
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body).toEqual({
      model: GPT_IMAGE_26_MODEL,
      prompt: '橙色香水瓶',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
      response_format: 'b64_json',
    })
    expect(body).not.toHaveProperty('providerOptions')
    expect(decodeAiGatewayTask(submitted.providerTaskId)?.usage?.cost).toBe(0.0501)
    const status = await gpt.getStatus!(submitted.providerTaskId, ctx)
    expect(status).toMatchObject({ state: 'succeeded', vendor: { cost: 0.0501, currency: 'USD', promptTokens: 20, completionTokens: 1449 } })
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain('gw-test-key')
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain(png)
  })

  it('有参考图时打 images/edits，没有上游金额时按 token 还原', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => Response.json({
      data: [{ b64_json: png }],
      usage: { input_tokens: 20, output_tokens: 1449, total_tokens: 1469 },
    }))
    const submitted = await provider().submit!({
      ...input,
      images: [{ url: 'https://r2.test/source.png' }],
      prompt: '换成白底',
    }, context(fetchImpl))
    expect(fetchImpl.mock.calls[0][0]).toBe('https://ai-gateway.vercel.sh/v1/images/edits')
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.images).toEqual([{ image_url: 'https://r2.test/source.png' }])
    expect(body.quality).toBe('medium')
    expect(body).not.toHaveProperty('messages')
    expect(decodeAiGatewayTask(submitted.providerTaskId)?.usage?.cost).toBe(0.04357)
  })

  it('拒绝蒙版、过高质量和非法尺寸', async () => {
    const fetchImpl = vi.fn()
    const gpt = provider()
    await expect(gpt.submit!({ ...input, mask: { url: 'https://r2.test/mask.png' } }, context(fetchImpl)))
      .rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(gpt.submit!({ ...input, providerParams: { ...input.providerParams, quality: 'high' } }, context(fetchImpl)))
      .rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(gpt.submit!({ ...input, providerParams: { size: '4096x4096', quality: 'medium' } }, context(fetchImpl)))
      .rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(gpt.acceptsModel!(GPT_IMAGE_26_MODEL)).toBe(true)
    expect(gpt.acceptsModel!('google/gemini-nano-banana-2.1')).toBe(false)
  })

  it('只打开 Nano Banana 时不能提交 GPT Image，超过 16 张参考图也不打上游', async () => {
    const fetchImpl = vi.fn()
    const nanoOnly = createAiGatewayImageProvider(
      () => ({ ...settings, model: 'google/gemini-nano-banana-2.1' }),
      memoryStore(),
      vi.fn(),
      () => null,
    )
    await expect(nanoOnly.submit!(input, context(fetchImpl))).rejects.toMatchObject({ code: 'INVALID_KEY' })
    await expect(provider().submit!({
      ...input,
      images: Array.from({ length: 17 }, () => ({ url: 'https://r2.test/a.png' })),
    }, context(fetchImpl))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
