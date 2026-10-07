import { randomUUID } from 'node:crypto'
import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import { HttpError } from '../../errors.js'
import { getObject, putObject } from '../../storage.js'
import { isAbortOrTimeout, mapHttpStatus, requestHost } from '../http.js'
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
  DEFAULT_OPENROUTER_INITIAL_POLL_DELAY_MS,
  DEFAULT_OPENROUTER_MAX_PARALLEL,
  DEFAULT_OPENROUTER_POLL_INTERVAL_MS,
  DEFAULT_OPENROUTER_TASK_TIMEOUT_MS,
  OPENROUTER_MAX_REFERENCE_IMAGES,
  openRouterImageAvailable,
  openRouterImageEnabled,
  openRouterImageSettings,
  type OpenRouterImageSettings,
} from './config.js'
import { OPENROUTER_IMAGE_CAPABILITIES, OPENROUTER_IMAGE_RATIOS, buildOpenRouterChatBody, mapOpenRouterImageRequest } from './mapping.js'
import {
  decodeOpenRouterTask,
  encodeOpenRouterTask,
  openRouterResultKey,
  openRouterResultUrl,
  parseOpenRouterImageResponse,
  type ParsedOpenRouterUsage,
} from './response.js'

export interface OpenRouterResultStore {
  putObject(key: string, bytes: Uint8Array, contentType: string): Promise<void>
  getObject(key: string): Promise<{ bytes: Uint8Array; contentType?: string } | undefined>
}

const inflight = new Map<string, Promise<{ providerTaskId: string }>>()

export function r2OpenRouterResultStore(): OpenRouterResultStore {
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

const CONTENT_REJECTION = /safety|content.?policy|moderat|违规|审核|unsafe/i
const PROVIDER_TERMS = /terms of service|\bToS\b/i
const USER_CONTENT_REJECTED = '内容未通过审核'
const USER_PROVIDER_FORBIDDEN = '图片服务暂不可用（上游权限限制）'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readErrorMessage(payload: unknown) {
  if (!isRecord(payload)) return ''
  if (typeof payload.message === 'string' && payload.message.trim()) return payload.message.trim()
  const error = payload.error
  if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) return error.message.trim()
  return ''
}

function readMetadata(payload: unknown) {
  if (!isRecord(payload)) return undefined
  const error = isRecord(payload.error) ? payload.error : undefined
  if (error && isRecord(error.metadata)) return error.metadata
  if (isRecord(payload.metadata)) return payload.metadata
  return undefined
}

function redactSecrets(value: string, apiKey?: string) {
  let text = value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, '[redacted]')
  if (apiKey && apiKey.length >= 8 && text.includes(apiKey)) text = text.split(apiKey).join('[redacted]')
  return text
}

function clipLogged(value: string, apiKey?: string) {
  return redactSecrets(value, apiKey).slice(0, 200)
}

function reasonText(item: unknown) {
  if (typeof item === 'string') return item
  if (item == null) return ''
  try {
    const text = JSON.stringify(item)
    return typeof text === 'string' ? text : ''
  } catch {
    return ''
  }
}

function hasFlaggedInput(metadata: Record<string, unknown>) {
  if (!('flagged_input' in metadata)) return false
  const flagged = metadata.flagged_input
  if (typeof flagged === 'string') return flagged.trim().length > 0
  if (Array.isArray(flagged)) return flagged.length > 0
  return flagged != null && flagged !== false
}

function hasReasons(metadata: Record<string, unknown>) {
  const reasons = metadata.reasons
  if (typeof reasons === 'string') return reasons.trim().length > 0
  if (!Array.isArray(reasons)) return false
  return reasons.some(item => reasonText(item).trim().length > 0)
}

function classifyOpenRouterFailure(status: number, message: string, metadata: Record<string, unknown> | undefined) {
  // 403 + Terms of Service 是上游权限，不是内容审核。必须先于审核判断。
  if (status === 403 && PROVIDER_TERMS.test(message)) {
    return new ProviderError('PROVIDER_FORBIDDEN', USER_PROVIDER_FORBIDDEN, false, 403)
  }
  if (CONTENT_REJECTION.test(message) || (metadata && (hasFlaggedInput(metadata) || hasReasons(metadata)))) {
    return new ProviderError('CONTENT_REJECTED', USER_CONTENT_REJECTED, false, 400)
  }
  return mapHttpStatus(status, message)
}

function loggedProviderName(metadata: Record<string, unknown> | undefined) {
  if (!metadata || typeof metadata.provider_name !== 'string') return null
  return clipLogged(metadata.provider_name)
}

function loggedReasons(metadata: Record<string, unknown> | undefined, apiKey: string) {
  if (!metadata || !('reasons' in metadata) || metadata.reasons == null) return null
  const reasons = Array.isArray(metadata.reasons) ? metadata.reasons : [metadata.reasons]
  return reasons.slice(0, 8).map(item => clipLogged(reasonText(item), apiKey))
}

function vendorOf(usage: ParsedOpenRouterUsage | undefined): ProviderVendorUsage {
  return {
    outputImageCount: 1,
    ...(usage?.promptTokens !== undefined ? { promptTokens: usage.promptTokens } : {}),
    ...(usage?.completionTokens !== undefined ? { completionTokens: usage.completionTokens } : {}),
    ...(usage?.totalTokens !== undefined ? { totalTokens: usage.totalTokens } : {}),
    ...(usage?.cost !== undefined ? { cost: usage.cost, currency: 'USD' } : {}),
  }
}

function usageLog(usage: ParsedOpenRouterUsage | undefined) {
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
  return `temporary/openrouter-results/${requestId}/${ordinal}.img`
}

function usageKey(key: string) {
  return key.replace(/\.img$/, '.usage.json')
}

function isImageSize(value: unknown): value is '1K' | '2K' | '4K' {
  return value === '1K' || value === '2K' || value === '4K'
}

function isRatio(value: unknown): value is string {
  return typeof value === 'string' && (OPENROUTER_IMAGE_RATIOS as readonly string[]).includes(value)
}

async function readUsage(store: OpenRouterResultStore, key: string) {
  const object = await store.getObject(usageKey(key))
  if (!object) return undefined
  try {
    const parsed: unknown = JSON.parse(Buffer.from(object.bytes).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    const record = parsed as ParsedOpenRouterUsage
    const usage: ParsedOpenRouterUsage = {
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

export function createOpenRouterImageProvider(
  readConfig: (env?: NodeJS.ProcessEnv) => OpenRouterImageSettings | null = openRouterImageSettings,
  store: OpenRouterResultStore = r2OpenRouterResultStore(),
): ImageProvider {
  const settingsOf = (env?: NodeJS.ProcessEnv) => {
    const settings = readConfig(env)
    if (!settings) throw new ProviderError('INVALID_KEY', '尚未配置 OpenRouter API Key', false, 503)
    return settings
  }

  async function postChat(url: string, body: unknown, settings: OpenRouterImageSettings, ctx: ProviderContext) {
    const started = ctx.now()
    let response: Response
    try {
      response = await ctx.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ctx.signal ?? AbortSignal.timeout(settings.requestTimeoutMs),
      })
    } catch (error) {
      const timeout = isAbortOrTimeout(error)
      ctx.log({
        stage: 'openrouter-image-submit',
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
      const upstreamMessage = readErrorMessage(payload)
      const metadata = readMetadata(payload)
      const failure = classifyOpenRouterFailure(response.status, upstreamMessage, metadata)
      ctx.log({
        stage: 'openrouter-image-submit',
        status: response.status,
        host: requestHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
        code: failure.code,
        upstreamMessage: clipLogged(upstreamMessage, settings.apiKey),
        provider_name: loggedProviderName(metadata),
        reasons: loggedReasons(metadata, settings.apiKey),
      })
      throw failure
    }
    return { payload, started }
  }

  async function generate(input: ProviderSubmitInput, ctx: ProviderContext, key: string) {
    const existing = await store.getObject(key)
    if (existing?.bytes.byteLength) {
      const usage = await readUsage(store, key)
      ctx.log({ stage: 'openrouter-image-replay', requestId: ctx.requestId, ordinal: input.ordinal ?? 0, ...usageLog(usage) })
      return {
        providerTaskId: encodeOpenRouterTask({
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
    const body = buildOpenRouterChatBody({
      model: input.model || settings.model,
      prompt: input.prompt,
      images: input.images,
      aspectRatio,
      imageSize,
    })
    const url = `${settings.baseUrl}/chat/completions`
    const { payload, started } = await postChat(url, body, settings, ctx)
    const parsed = parseOpenRouterImageResponse(payload)
    ctx.log({
      stage: 'openrouter-image-submit',
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
          stage: 'openrouter-image-usage-store',
          requestId: ctx.requestId,
          error: error instanceof Error ? error.name : 'error',
        })
      }
    }
    return { providerTaskId: encodeOpenRouterTask({ key, mimeType: image.mimeType, ...(parsed.usage ? { usage: parsed.usage } : {}) }) }
  }

  return {
    id: 'openrouter',
    capabilities(): ProviderCapabilities {
      return {
        ...OPENROUTER_IMAGE_CAPABILITIES,
        operations: [...OPENROUTER_IMAGE_CAPABILITIES.operations],
        ratios: [...OPENROUTER_IMAGE_CAPABILITIES.ratios],
        resolutions: [...OPENROUTER_IMAGE_CAPABILITIES.resolutions],
      }
    },
    configured(env?: NodeJS.ProcessEnv) {
      return openRouterImageEnabled(env) && readConfig(env) !== null
    },
    acceptsModel(model: string, env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return openRouterImageAvailable(env) && settings?.model === model
    },
    mapRequest(req: NormalizedImageRequest, model: string) {
      return mapOpenRouterImageRequest(req, model)
    },
    jobPolicy(env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return {
        taskTimeoutMs: settings?.taskTimeoutMs ?? DEFAULT_OPENROUTER_TASK_TIMEOUT_MS,
        pollIntervalMs: settings?.pollIntervalMs ?? DEFAULT_OPENROUTER_POLL_INTERVAL_MS,
        initialPollDelayMs: settings?.initialPollDelayMs ?? DEFAULT_OPENROUTER_INITIAL_POLL_DELAY_MS,
        maxParallel: settings?.maxParallel ?? DEFAULT_OPENROUTER_MAX_PARALLEL,
      }
    },
    async submit(input, ctx) {
      if (input.mask) throw new ProviderError('INVALID_PARAMS', '当前模型不支持蒙版', false, 400)
      if (input.images.length > OPENROUTER_MAX_REFERENCE_IMAGES) {
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
      const task = decodeOpenRouterTask(providerTaskId)
      const key = task ? openRouterResultKey(openRouterResultUrl(task.key)) : undefined
      if (!task || !key) {
        return { state: 'failed', code: 'BAD_RESPONSE', message: '图片任务编号无效', retryable: false }
      }
      const object = await store.getObject(key)
      if (!object?.bytes.byteLength) {
        return { state: 'failed', code: 'BAD_RESPONSE', message: '图片服务没有返回图片', retryable: false }
      }
      return { state: 'succeeded', resultUrls: [openRouterResultUrl(key)], vendor: vendorOf(task.usage) }
    },
    async fetchResult(url: string) {
      const key = openRouterResultKey(url)
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

export const openRouterImageProvider = createOpenRouterImageProvider()
