import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GPT_IMAGE_26_MODEL, NANO_BANANA_MODEL } from '../../../shared/image-models.js'
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
  model: NANO_BANANA_MODEL,
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
  model: NANO_BANANA_MODEL,
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

  it('恢复只读同一次尝试的缓存，其他账号、环境、任务或尝试均不命中', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagePayload()))
    const store = memoryStore()
    const provider = createAiGatewayImageProvider(() => settings, store, vi.fn())
    const execution = {
      scope: 'preview',
      userId: '00000000-0000-4000-8000-000000000001',
      jobId: '00000000-0000-4000-8000-000000000002',
      attemptId: '00000000-0000-4000-8000-000000000003',
    }
    const ctx = { ...context(fetchImpl), execution }
    const submitted = await provider.submit!(input, ctx)
    expect(decodeAiGatewayTask(submitted.providerTaskId)?.key).toBe(
      `temporary/ai-gateway-results/preview/${execution.userId}/${execution.jobId}/${execution.attemptId}/0.img`,
    )
    fetchImpl.mockClear()
    expect(await provider.recoverSubmission!(0, { ...ctx, requestId: '另一个 HTTP 请求' })).toEqual(submitted)
    for (const identity of [
      { ...execution, scope: 'production' },
      { ...execution, userId: '00000000-0000-4000-8000-000000000004' },
      { ...execution, jobId: '00000000-0000-4000-8000-000000000004' },
      { ...execution, attemptId: '00000000-0000-4000-8000-000000000004' },
    ]) {
      expect(await provider.recoverSubmission!(0, { ...ctx, execution: identity })).toBeUndefined()
    }
    expect(await provider.recoverSubmission!(1, ctx)).toBeUndefined()
    expect(await provider.recoverSubmission!(0, context(fetchImpl))).toBeUndefined()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(store.objects.size).toBe(2)
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

describe('AI Gateway GPT Image 2.6', () => {
  const gptSettings: AiGatewayImageSettings = { ...settings, model: GPT_IMAGE_26_MODEL }
  const gptInput = {
    model: GPT_IMAGE_26_MODEL,
    prompt: '橙色香水瓶',
    images: [] as Array<{ url: string }>,
    providerParams: { size: '1024x1024', quality: 'medium', resolution: '1k', aspectRatio: '1:1', n: 1 },
    ordinal: 0,
  }

  function imagesPayload(cost?: number) {
    return {
      output_format: 'png',
      data: [{ b64_json: jpeg }],
      usage: {
        input_tokens: 100,
        output_tokens: 1756,
        total_tokens: 1856,
        ...(cost === undefined ? {} : { cost }),
      },
    }
  }

  function gptProvider(store = memoryStore()) {
    return createAiGatewayImageProvider(() => null, store, vi.fn(), () => gptSettings)
  }

  it('文生图提交 Images generations，不走 chat completions', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagesPayload(0.04)))
    const provider = gptProvider()
    const ctx = context(fetchImpl)
    const submitted = await provider.submit!(gptInput, ctx)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/images/generations')
    expect(String(url)).not.toContain('chat/completions')
    const body = JSON.parse(String(request?.body))
    expect(body).toEqual({
      model: GPT_IMAGE_26_MODEL,
      prompt: '橙色香水瓶',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    })
    expect(body).not.toHaveProperty('modalities')
    expect(body).not.toHaveProperty('providerOptions')
    expect(decodeAiGatewayTask(submitted.providerTaskId)?.usage?.cost).toBe(0.04)
    const status = await provider.getStatus!(submitted.providerTaskId, ctx)
    expect(status).toMatchObject({ state: 'succeeded', vendor: { cost: 0.04, currency: 'USD', promptTokens: 100, completionTokens: 1756 } })
    expect(ctx.log).toHaveBeenCalledWith(expect.objectContaining({
      stage: 'ai-gateway-image-submit',
      endpoint: 'images/generations',
      imageShape: 'images-b64',
      quality: 'medium',
    }))
  })

  it('有参考图时提交 Images edits，没有上游 cost 时按 token 估算', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(imagesPayload()))
    const provider = gptProvider()
    const ctx = context(fetchImpl)
    const submitted = await provider.submit!({
      ...gptInput,
      images: [{ url: 'https://r2.test/source.png' }, { url: 'https://r2.test/ref.png' }],
      providerParams: { ...gptInput.providerParams, size: '2048x1360' },
    }, ctx)
    const [url, request] = fetchImpl.mock.calls[0]
    expect(url).toBe('https://ai-gateway.vercel.sh/v1/images/edits')
    expect(String(url)).not.toContain('chat/completions')
    const body = JSON.parse(String(request?.body))
    expect(body.quality).toBe('medium')
    expect(body.images).toEqual([
      { image_url: 'https://r2.test/source.png' },
      { image_url: 'https://r2.test/ref.png' },
    ])
    expect(body).not.toHaveProperty('modalities')
    expect(decodeAiGatewayTask(submitted.providerTaskId)?.usage?.cost).toBe(0.05318)
    const status = await provider.getStatus!(submitted.providerTaskId, ctx)
    expect(status).toMatchObject({ state: 'succeeded', vendor: { cost: 0.05318, currency: 'USD' } })
  })

  it('Nano Banana 的开关不能提交 GPT Image，蒙版和超额参考图也不打上游', async () => {
    const fetchImpl = vi.fn()
    const nanoOnly = createAiGatewayImageProvider(() => settings, memoryStore(), vi.fn(), () => null)
    await expect(nanoOnly.submit!(gptInput, context(fetchImpl))).rejects.toMatchObject({ code: 'INVALID_KEY' })
    const provider = gptProvider()
    await expect(provider.submit!({ ...gptInput, mask: { url: 'https://r2.test/mask.png' } }, context(fetchImpl)))
      .rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    await expect(provider.submit!({
      ...gptInput,
      images: Array.from({ length: 17 }, () => ({ url: 'https://r2.test/a.png' })),
    }, context(fetchImpl))).rejects.toMatchObject({ code: 'INVALID_PARAMS' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
