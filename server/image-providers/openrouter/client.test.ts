import { describe, expect, it, vi } from 'vitest'
import { OPENROUTER_NANO_BANANA_MODEL } from '../../../shared/image-models.js'
import { MOCK_PNG_1X1 } from '../mock.js'
import type { OpenRouterResultStore } from './client.js'
import { createOpenRouterImageProvider } from './client.js'
import type { OpenRouterImageSettings } from './config.js'
import { decodeOpenRouterTask } from './response.js'

const settings: OpenRouterImageSettings = {
  apiKey: 'sk-test-openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: OPENROUTER_NANO_BANANA_MODEL,
  requestTimeoutMs: 1_000,
  taskTimeoutMs: 300_000,
  pollIntervalMs: 2_000,
  initialPollDelayMs: 130_000,
  maxParallel: 4,
}

const png = Buffer.from(MOCK_PNG_1X1).toString('base64')
const dataUrl = `data:image/png;base64,${png}`

function memoryStore(): OpenRouterResultStore & { objects: Map<string, { bytes: Uint8Array; contentType?: string }> } {
  const objects = new Map<string, { bytes: Uint8Array; contentType?: string }>()
  return {
    objects,
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

function imagePayload(usage: Record<string, unknown> | undefined = {
  prompt_tokens: 12, completion_tokens: 1120, total_tokens: 1132, cost: 0.04,
}) {
  return {
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: dataUrl } }] } }],
    ...(usage ? { usage } : {}),
  }
}

function context(fetchImpl: typeof fetch) {
  return {
    fetch: fetchImpl,
    sleep: async () => undefined,
    now: () => 1_000,
    log: vi.fn(),
    requestId: '00000000-0000-4000-8000-000000000901',
  }
}

const input = {
  model: OPENROUTER_NANO_BANANA_MODEL,
  prompt: '橙色香水瓶',
  images: [] as Array<{ url: string }>,
  providerParams: { aspectRatio: '16:9', imageSize: '2K', resolution: '2k', n: 1 },
  ordinal: 0,
}

describe('OpenRouter 图片客户端', () => {
  it('提交 chat completions，解析 base64，并把 usage 留在任务编号里', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagePayload()))
    const store = memoryStore()
    const provider = createOpenRouterImageProvider(() => settings, store)
    const ctx = context(fetchImpl)
    const submitted = await provider.submit!(input, ctx)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions')
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer sk-test-openrouter' })
    const body = JSON.parse(String(request?.body))
    expect(body.modalities).toEqual(['image', 'text'])
    expect(body.image_config).toEqual({ aspect_ratio: '16:9', image_size: '2K' })
    expect(body).not.toHaveProperty('plugins')
    expect(body).not.toHaveProperty('tools')
    expect(JSON.stringify(body)).not.toContain('web_search')
    const task = decodeOpenRouterTask(submitted.providerTaskId)
    expect(task?.usage).toEqual({ promptTokens: 12, completionTokens: 1120, totalTokens: 1132, cost: 0.04 })
    const status = await provider.getStatus!(submitted.providerTaskId, ctx)
    expect(status).toMatchObject({
      state: 'succeeded',
      vendor: { promptTokens: 12, completionTokens: 1120, totalTokens: 1132, cost: 0.04, currency: 'USD', outputImageCount: 1 },
    })
    if (status.state !== 'succeeded') throw new Error('expected image')
    const downloaded = await provider.fetchResult(status.resultUrls[0], ctx)
    expect(downloaded.mimeType).toBe('image/png')
    expect(downloaded.bytes).toEqual(MOCK_PNG_1X1)
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain('sk-test-openrouter')
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain(png)
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'openrouter-image-submit',
      promptTokens: 12,
      completionTokens: 1120,
      totalTokens: 1132,
      cost: 0.04,
      currency: 'USD',
      imageShape: 'message-images',
      referenceCount: 0,
    }))
  })

  it('参考图放进 content，同一结果不重复请求', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagePayload()))
    const provider = createOpenRouterImageProvider(() => settings, memoryStore())
    const ctx = context(fetchImpl)
    const withImage = { ...input, images: [{ url: 'https://r2.test/source.png' }] }
    const first = await provider.submit!(withImage, ctx)
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1]?.body))
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '橙色香水瓶' },
      { type: 'image_url', image_url: { url: 'https://r2.test/source.png' } },
    ])
    const second = await provider.submit!(withImage, ctx)
    expect(second.providerTaskId).toBe(first.providerTaskId)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'openrouter-image-replay', cost: 0.04 }))
  })

  it('失败响应不重试，没有图片时也不把空结果当成成功', async () => {
    const denied = vi.fn().mockImplementation(async () => jsonResponse({ error: { message: 'content policy violation' } }, 400))
    const provider = createOpenRouterImageProvider(() => settings, memoryStore())
    await expect(provider.submit!(input, context(denied))).rejects.toMatchObject({ code: 'CONTENT_REJECTED', retryable: false })
    expect(denied).toHaveBeenCalledTimes(1)

    const empty = vi.fn().mockImplementation(async () => jsonResponse({ choices: [{ message: { content: '没有图' } }], usage: { prompt_tokens: 3, cost: 0.001 } }))
    const emptyProvider = createOpenRouterImageProvider(() => settings, memoryStore())
    const ctx = context(empty)
    await expect(emptyProvider.submit!(input, ctx)).rejects.toMatchObject({ code: 'BAD_RESPONSE' })
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({ stage: 'openrouter-image-submit', imageCount: 0, cost: 0.001 }))
    expect(empty).toHaveBeenCalledTimes(1)
  })

  it('没有 Key 时不能提交', async () => {
    const provider = createOpenRouterImageProvider(() => null, memoryStore())
    await expect(provider.submit!(input, context(vi.fn()))).rejects.toMatchObject({ code: 'INVALID_KEY' })
  })
})
