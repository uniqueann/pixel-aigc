import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OPENROUTER_NANO_BANANA_MODEL } from '../../../shared/image-models.js'
import { MOCK_PNG_1X1 } from '../mock.js'
import type { AiGatewayResultStore } from './client.js'
import { createAiGatewayImageProvider } from './client.js'
import type { AiGatewayImageSettings } from './config.js'
import { decodeAiGatewayTask, encodeAiGatewayTask } from './response.js'

const { send } = vi.hoisted(() => ({ send: vi.fn() }))
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = send },
  GetObjectCommand: class { constructor(public input: unknown) {} },
  PutObjectCommand: class { constructor(public input: unknown) {} },
  DeleteObjectCommand: class { constructor(public input: unknown) {} },
}))
vi.mock('@vercel/oidc', () => ({ getVercelOidcToken: vi.fn(async () => 'unused-oidc') }))

const settings: AiGatewayImageSettings = {
  apiKey: 'gw-test-key',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  model: OPENROUTER_NANO_BANANA_MODEL,
  requestTimeoutMs: 1_000,
  taskTimeoutMs: 300_000,
  pollIntervalMs: 2_000,
  initialPollDelayMs: 130_000,
  maxParallel: 4,
}

const jpeg = Buffer.from(MOCK_PNG_1X1).toString('base64')
const dataUrl = `data:image/jpeg;base64,${jpeg}`

function memoryStore(): AiGatewayResultStore & { objects: Map<string, { bytes: Uint8Array; contentType?: string }> } {
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

function imagePayload(cost = 0.0393585) {
  return {
    choices: [{ message: { images: [{ type: 'image_url', image_url: { url: dataUrl } }] } }],
    usage: { prompt_tokens: 20, completion_tokens: 1400, total_tokens: 1420, cost },
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
  providerParams: { aspectRatio: '1:1', imageSize: '1K', resolution: '1k', n: 1 },
  ordinal: 0,
}

describe('AI Gateway 图片客户端', () => {
  it('提交 chat completions，解析 jpeg，并把 usage.cost 留在任务编号里', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagePayload()))
    const provider = createAiGatewayImageProvider(() => settings, memoryStore(), vi.fn())
    const ctx = context(fetchImpl)
    const submitted = await provider.submit!(input, ctx)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/chat/completions')
    expect(request?.headers).toMatchObject({ Authorization: 'Bearer gw-test-key' })
    const body = JSON.parse(String(request?.body))
    expect(body.modalities).toEqual(['text', 'image'])
    expect(body.providerOptions).toEqual({
      google: { imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
      vertex: { imageConfig: { aspectRatio: '1:1', imageSize: '1K' } },
    })
    expect(body).not.toHaveProperty('image_config')
    const task = decodeAiGatewayTask(submitted.providerTaskId)
    expect(task?.usage?.cost).toBe(0.0393585)
    const status = await provider.getStatus!(submitted.providerTaskId, ctx)
    expect(status).toMatchObject({
      state: 'succeeded',
      vendor: { cost: 0.0393585, currency: 'USD', outputImageCount: 1, promptTokens: 20 },
    })
    if (status.state !== 'succeeded') throw new Error('expected image')
    const downloaded = await provider.fetchResult(status.resultUrls[0], ctx)
    expect(downloaded.mimeType).toBe('image/jpeg')
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain('gw-test-key')
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain(jpeg)
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'ai-gateway-image-submit',
      cost: 0.0393585,
      currency: 'USD',
      imageShape: 'message-images',
    }))
  })

  it('没有 API Key 时使用 OIDC，失败响应不重试', async () => {
    const readOidc = vi.fn(async () => 'oidc-test-token')
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagePayload()))
    const provider = createAiGatewayImageProvider(() => ({ ...settings, apiKey: undefined }), memoryStore(), readOidc)
    await provider.submit!(input, context(fetchImpl))
    expect(readOidc).toHaveBeenCalledTimes(1)
    expect(fetchImpl.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer oidc-test-token' })

    const denied = vi.fn().mockImplementation(async () => jsonResponse({
      error: { message: `ToS violation Bearer oidc-test-token`, type: 'permission_error' },
    }, 403))
    const failing = createAiGatewayImageProvider(() => ({ ...settings, apiKey: undefined }), memoryStore(), readOidc)
    const ctx = context(denied)
    await expect(failing.submit!(input, ctx)).rejects.toMatchObject({ code: 'PROVIDER_FORBIDDEN', retryable: false })
    expect(denied).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(ctx.log.mock.calls)).not.toContain('oidc-test-token')
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'ai-gateway-image-submit',
      status: 403,
      code: 'PROVIDER_FORBIDDEN',
      upstreamMessage: expect.stringContaining('[redacted]'),
    }))
  })

  it('402、核验失败和免费层都映射成余额或权限，且不重试', async () => {
    const balance = vi.fn().mockImplementation(async () => jsonResponse({ error: { message: 'Insufficient credits' } }, 402))
    await expect(createAiGatewayImageProvider(() => settings, memoryStore(), vi.fn()).submit!(input, context(balance)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', status: 402, retryable: false })
    expect(balance).toHaveBeenCalledTimes(1)

    const verify = vi.fn().mockImplementation(async () => jsonResponse({
      error: { message: 'add a card', type: 'customer_verification_required' },
    }, 403))
    await expect(createAiGatewayImageProvider(() => settings, memoryStore(), vi.fn()).submit!(input, context(verify)))
      .rejects.toMatchObject({ code: 'PROVIDER_FORBIDDEN', retryable: false })

    const freeTier = vi.fn().mockImplementation(async () => jsonResponse({
      error: { message: 'Free tier users do not have access to this model.', type: 'no_providers_available' },
    }, 403))
    await expect(createAiGatewayImageProvider(() => settings, memoryStore(), vi.fn()).submit!(input, context(freeTier)))
      .rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE', retryable: false })
  })

  it('没有凭证时不能提交，审核拒绝不重试', async () => {
    const readOidc = vi.fn(async () => { throw new Error('no oidc') })
    const provider = createAiGatewayImageProvider(() => ({ ...settings, apiKey: undefined }), memoryStore(), readOidc)
    await expect(provider.submit!(input, context(vi.fn()))).rejects.toMatchObject({ code: 'INVALID_KEY' })

    const moderated = vi.fn().mockImplementation(async () => jsonResponse({ error: { message: 'content policy violation' } }, 400))
    await expect(createAiGatewayImageProvider(() => settings, memoryStore(), vi.fn()).submit!(input, context(moderated)))
      .rejects.toMatchObject({ code: 'CONTENT_REJECTED', retryable: false })
    expect(moderated).toHaveBeenCalledTimes(1)
  })
})

describe('AI Gateway 结果对象不存在', () => {
  const requestId = '00000000-0000-4000-8000-000000000901'
  const resultKey = `temporary/ai-gateway-results/${requestId}/0.img`

  beforeEach(() => {
    send.mockReset()
    process.env.R2_ACCOUNT_ID = 'test'
    process.env.R2_ACCESS_KEY_ID = 'test'
    process.env.R2_SECRET_ACCESS_KEY = 'test'
    process.env.R2_BUCKET = 'test'
  })

  it('S3 抛 NoSuchKey 时仍提交上游', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('The specified key does not exist.'), {
      name: 'NoSuchKey',
      $metadata: { httpStatusCode: 404 },
    }))
    send.mockResolvedValue({})
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagePayload()))
    const provider = createAiGatewayImageProvider(() => settings)
    const ctx = context(fetchImpl)
    const submitted = await provider.submit!(input, ctx)
    expect(send.mock.calls[0][0].input).toMatchObject({ Key: resultKey })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(decodeAiGatewayTask(submitted.providerTaskId)?.key).toBe(resultKey)
  })

  it('查询和下载遇到 NoSuchKey 时返回明确失败', async () => {
    send.mockRejectedValue(Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }))
    const provider = createAiGatewayImageProvider(() => settings)
    const ctx = context(vi.fn())
    const taskId = encodeAiGatewayTask({ key: resultKey, mimeType: 'image/jpeg' })
    await expect(provider.getStatus!(taskId, ctx)).resolves.toMatchObject({
      state: 'failed', code: 'BAD_RESPONSE', message: '图片服务没有返回图片',
    })
    await expect(provider.fetchResult(`ai-gateway-object:${resultKey}`, ctx)).rejects.toMatchObject({
      code: 'BAD_RESPONSE',
    })
  })
})
