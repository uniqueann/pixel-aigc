import { randomUUID } from 'node:crypto'
import { readVercelOidcToken } from '../../ai-gateway-auth.js'
export { readVercelOidcToken } from '../../ai-gateway-auth.js'
import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import { HttpError } from '../../errors.js'
import { getObject, putObject } from '../../storage.js'
import { isAbortOrTimeout, requestHost } from '../http.js'
import type {
  ImageProvider,
  ProviderCapabilities,
  ProviderContext,
  ProviderSubmitInput,
  ProviderTaskState,
  ProviderVendorUsage,
} from '../types.js'
import { ProviderError } from '../types.js'
import {
  AI_GATEWAY_MAX_REFERENCE_IMAGES,
  DEFAULT_AI_GATEWAY_INITIAL_POLL_DELAY_MS,
  DEFAULT_AI_GATEWAY_MAX_PARALLEL,
  DEFAULT_AI_GATEWAY_POLL_INTERVAL_MS,
  DEFAULT_AI_GATEWAY_TASK_TIMEOUT_MS,
  aiGatewayImageAvailable,
  aiGatewayImageSettings,
  type AiGatewayImageSettings,
} from './config.js'
import { classifyAiGatewayFailure, clipGatewayLog, readGatewayFailure } from './errors.js'
import { AI_GATEWAY_IMAGE_CAPABILITIES, AI_GATEWAY_IMAGE_RATIOS, buildAiGatewayChatBody, mapAiGatewayImageRequest } from './mapping.js'
import {
  aiGatewayResultKey,
  aiGatewayResultUrl,
  decodeAiGatewayTask,
  encodeAiGatewayTask,
  parseAiGatewayImageResponse,
  type ParsedAiGatewayUsage,
} from './response.js'

export interface AiGatewayResultStore {
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  getObject(key: string): Promise<{ bytes: Uint8Array; contentType?: string } | undefined>
}

const inflight = new Map<string, Promise<{ providerTaskId: string }>>()

export function r2AiGatewayResultStore(): AiGatewayResultStore {
  return {
    async putObject(key, bytes, contentType) {
      await putObject(key, bytes, contentType)
    },
    async getObject(key) {
      try {
        const object = await getObject(key)
        return { bytes: object.bytes, contentType: object.contentType }
      } catch (error) {
        if (error instanceof HttpError && error.status === 404) return undefined
        throw error
      }
    },
  }
}

function vendorOf(usage: ParsedAiGatewayUsage | undefined): ProviderVendorUsage {
  return {
    outputImageCount: 1,
    ...(usage?.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage?.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage?.cost !== undefined ? { cost: usage.cost, currency: 'USD' } : {}),
  }
}

function usageLog(usage: ParsedAiGatewayUsage | undefined) {
  return {
    ...(usage?.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage?.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage?.cost !== undefined ? { cost: usage.cost, currency: 'USD' } : {}),
  }
}

function safeRequestId(requestId: string | undefined) {
  return requestId && /^[0-9a-f-]{36}$/i.test(requestId) ? requestId : randomUUID()
}

function imageKey(requestId: string, ordinal: number) {
  return `temporary/ai-gateway-results/${requestId}/${ordinal}.img`
}

function usageKey(key: string) {
  return key.replace(/\.img$/, '.usage.json')
}

function isImageSize(value: unknown): value is '1K' | '2K' | '4K' {
  return value === '1K' || value === '2K' || value === '4K'
}

function isRatio(value: unknown): value is string {
  return typeof value === 'string' && (AI_GATEWAY_IMAGE_RATIOS as readonly string[]).includes(value)
}

async function readUsage(store: AiGatewayResultStore, key: string) {
  const object = await store.getObject(usageKey(key))
  if (!object) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(object.bytes).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as ParsedAiGatewayUsage
    const usage: ParsedAiGatewayUsage = {
      ...(typeof record.promptTokens === 'number' ? { promptTokens: record.promptTokens } : {}),
      ...(typeof record.completionTokens === 'number' ? { completionTokens: record.completionTokens } : {}),
      ...(typeof record.totalTokens === 'number' ? { totalTokens: record.totalTokens } : {}),
      ...(typeof record.cost === 'number' ? { cost: record.cost } : {}),
    }
    return usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.totalTokens !== undefined || usage.cost !== undefined
      ? usage
      : undefined
  } catch {
    return undefined
  }
}

async function bearerToken(settings: AiGatewayImageSettings, readOidc: () => Promise<string>) {
  if (settings.apiKey) return settings.apiKey
  try {
    const token = (await readOidc()).trim()
    if (token) return token
  } catch {
    // OIDC 刷新失败时按未配置处理，避免把令牌或堆栈带回给用户。
  }
  throw new ProviderError('INVALID_KEY', '尚未配置 AI Gateway 凭证', false, 503)
}

export function createAiGatewayImageProvider(
  readConfig: (env?: NodeJS.ProcessEnv) => AiGatewayImageSettings | null = aiGatewayImageSettings,
  store: AiGatewayResultStore = r2AiGatewayResultStore(),
  readOidc: () => Promise<string> = readVercelOidcToken,
): ImageProvider {
  const settingsOf = (env?: NodeJS.ProcessEnv) => {
    const settings = readConfig(env)
    if (!settings) throw new ProviderError('INVALID_KEY', '尚未配置 AI Gateway 凭证', false, 503)
    return settings
  }

  async function postChat(url: string, body: unknown, settings: AiGatewayImageSettings, token: string, ctx: ProviderContext) {
    const started = ctx.now()
    let response: Response
    try {
      response = await ctx.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctx.signal ?? AbortSignal.timeout(settings.requestTimeoutMs),
      })
    } catch (error) {
      const timeout = isAbortOrTimeout(error)
      ctx.log({
        stage: 'ai-gateway-image-submit',
        retry: false,
        host: requestHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
        error: error instanceof Error ? error.name : 'error',
      })
      throw new ProviderError(
        timeout ? 'TIMEOUT' : 'UPSTREAM_UNAVAILABLE',
        timeout ? '图片服务请求超时，请稍后重试' : '图片服务连接失败，请稍后重试',
        false,
        timeout ? 504 : 502,
      )
    }
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const details = readGatewayFailure(payload)
      const failure = classifyAiGatewayFailure(response.status, payload)
      ctx.log({
        stage: 'ai-gateway-image-submit',
        status: response.status,
        host: requestHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
        code: failure.code,
        errorType: details.type || null,
        upstreamMessage: clipGatewayLog(details.message, [settings.apiKey, token]),
      })
      throw failure
    }
    return { payload, started }
  }

  async function generate(input: ProviderSubmitInput, ctx: ProviderContext, key: string) {
    const existing = await store.getObject(key)
    if (existing?.bytes.byteLength) {
      const usage = await readUsage(store, key)
      ctx.log({ stage: 'ai-gateway-image-replay', requestId: ctx.requestId, ordinal: input.ordinal ?? 0, ...usageLog(usage) })
      return {
        providerTaskId: encodeAiGatewayTask({
          key,
          mimeType: existing.contentType?.startsWith('image/') ? existing.contentType : 'image/png',
          ...(usage ? { usage } : {}),
        }),
      }
    }
    const settings = settingsOf()
    const aspectRatio = input.providerParams.aspectRatio
    const imageSize = input.providerParams.imageSize
    if (!isRatio(aspectRatio) || !isImageSize(imageSize)) {
      throw new ProviderError('INVALID_PARAMS', '图片尺寸不被支持', false, 400)
    }
    const token = await bearerToken(settings, readOidc)
    const body = buildAiGatewayChatBody({
      model: input.model || settings.model,
      prompt: input.prompt,
      images: input.images,
      aspectRatio,
      imageSize,
    })
    const url = `${settings.baseUrl}/chat/completions`
    const { payload, started } = await postChat(url, body, settings, token, ctx)
    const parsed = parseAiGatewayImageResponse(payload)
    ctx.log({
      stage: 'ai-gateway-image-submit',
      status: 200,
      host: requestHost(url),
      ms: ctx.now() - started,
      requestId: ctx.requestId,
      aspectRatio,
      imageSize,
      referenceCount: input.images.length,
      imageCount: parsed.images.length,
      ...(parsed.shape ? { imageShape: parsed.shape } : {}),
      ...usageLog(parsed.usage),
    })
    const image = parsed.images[0]
    if (!image) throw new ProviderError('BAD_RESPONSE', '图片服务没有返回图片', false, 502)
    await store.putObject(key, image.bytes, image.mimeType)
    if (parsed.usage) {
      try {
        await store.putObject(usageKey(key), Buffer.from(JSON.stringify(parsed.usage)), 'application/json')
      } catch (error) {
        ctx.log({
          stage: 'ai-gateway-image-usage-store',
          requestId: ctx.requestId,
          error: error instanceof Error ? error.name : 'error',
        })
      }
    }
    return { providerTaskId: encodeAiGatewayTask({ key, mimeType: image.mimeType, ...(parsed.usage ? { usage: parsed.usage } : {}) }) }
  }

  return {
    id: 'ai-gateway',
    capabilities(): ProviderCapabilities {
      return {
        ...AI_GATEWAY_IMAGE_CAPABILITIES,
        operations: [...AI_GATEWAY_IMAGE_CAPABILITIES.operations],
        ratios: [...AI_GATEWAY_IMAGE_CAPABILITIES.ratios],
        resolutions: [...AI_GATEWAY_IMAGE_CAPABILITIES.resolutions],
      }
    },
    configured(env?: NodeJS.ProcessEnv) {
      return readConfig(env) !== null
    },
    acceptsModel(model: string, env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return aiGatewayImageAvailable(env) && settings?.model === model
    },
    mapRequest(req: NormalizedImageRequest, model: string) {
      return mapAiGatewayImageRequest(req, model)
    },
    jobPolicy(env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return {
        taskTimeoutMs: settings?.taskTimeoutMs ?? DEFAULT_AI_GATEWAY_TASK_TIMEOUT_MS,
        pollIntervalMs: settings?.pollIntervalMs ?? DEFAULT_AI_GATEWAY_POLL_INTERVAL_MS,
        initialPollDelayMs: settings?.initialPollDelayMs ?? DEFAULT_AI_GATEWAY_INITIAL_POLL_DELAY_MS,
        maxParallel: settings?.maxParallel ?? DEFAULT_AI_GATEWAY_MAX_PARALLEL,
      }
    },
    async submit(input, ctx) {
      if (input.mask) throw new ProviderError('INVALID_PARAMS', '当前模型不支持蒙版', false, 400)
      if (input.images.length > AI_GATEWAY_MAX_REFERENCE_IMAGES) {
        throw new ProviderError('INVALID_PARAMS', '参考图数量超过上限', false, 400)
      }
      if (!input.prompt.trim()) throw new ProviderError('INVALID_PARAMS', '请填写画面描述', false, 400)
      const ordinal = Number.isInteger(input.ordinal) && (input.ordinal ?? 0) >= 0 ? input.ordinal ?? 0 : 0
      const key = imageKey(safeRequestId(ctx.requestId), ordinal)
      const pending = inflight.get(key)
      if (pending) return pending
      const run = generate(input, ctx, key).finally(() => { inflight.delete(key) })
      inflight.set(key, run)
      return run
    },
    async getStatus(providerTaskId: string): Promise<ProviderTaskState> {
      const task = decodeAiGatewayTask(providerTaskId)
      const key = task ? aiGatewayResultKey(aiGatewayResultUrl(task.key)) : undefined
      if (!task || !key) {
        return { state: 'failed', code: 'BAD_RESPONSE', message: '图片任务编号无效', retryable: false }
      }
      const object = await store.getObject(key)
      if (!object?.bytes.byteLength) {
        return { state: 'failed', code: 'BAD_RESPONSE', message: '图片服务没有返回图片', retryable: false }
      }
      return { state: 'succeeded', resultUrls: [aiGatewayResultUrl(key)], vendor: vendorOf(task.usage) }
    },
    async fetchResult(url: string) {
      const key = aiGatewayResultKey(url)
      if (!key) throw new ProviderError('BAD_RESPONSE', '结果图片地址无效', false, 502)
      const object = await store.getObject(key)
      const mimeType = object?.contentType?.split(';')[0]?.trim() ?? ''
      if (!object?.bytes.byteLength || !mimeType.startsWith('image/')) {
        throw new ProviderError('BAD_RESPONSE', '结果不是有效图片', false, 502)
      }
      return { bytes: object.bytes, mimeType }
    },
  }
}

export const aiGatewayImageProvider = createAiGatewayImageProvider()
