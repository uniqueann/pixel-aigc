import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import { fetchImageBytes, fetchJson, requestHost } from '../http.js'
import type {
  ImageProvider,
  ProviderCapabilities,
  ProviderContext,
  ProviderSubmitInput,
  ProviderTaskState,
} from '../types.js'
import { ProviderError } from '../types.js'
import { dragonCodeConfig, isDragonCodeConfigured, type DragonCodeConfig } from './config.js'
import { dragonCodeFailure, missingTaskError, sanitizePayload } from './errors.js'
import { DRAGONCODE_CAPABILITIES, mapDragonCodeRequest } from './mapping.js'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readCode(payload: unknown) {
  return isRecord(payload) && typeof payload.code === 'number' ? payload.code : undefined
}

function readSubmitTaskId(payload: unknown) {
  if (!isRecord(payload)) return undefined
  const data = payload.data
  if (Array.isArray(data) && isRecord(data[0])) return asString(data[0].task_id)
  if (isRecord(data)) return asString(data.task_id)
  return undefined
}

function readStatusPayload(payload: unknown) {
  if (!isRecord(payload)) return undefined
  return isRecord(payload.data) ? payload.data : payload
}

function readErrorMessage(payload: unknown, data?: Record<string, unknown>) {
  const error = data?.error ?? (isRecord(payload) ? payload.error : undefined)
  if (isRecord(error) && typeof error.message === 'string') return error.message
  if (isRecord(payload) && typeof payload.message === 'string') return payload.message
  return ''
}

function readResultUrls(data: Record<string, unknown>) {
  const result = isRecord(data.result) ? data.result : undefined
  const images = Array.isArray(result?.images) ? result.images : []
  const urls: string[] = []
  for (const image of images) {
    if (!isRecord(image)) continue
    if (Array.isArray(image.url)) {
      for (const url of image.url) if (typeof url === 'string' && url) urls.push(url)
    } else if (typeof image.url === 'string' && image.url) {
      urls.push(image.url)
    }
  }
  return urls
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

export function createDragonCodeProvider(
  readConfig: (env?: NodeJS.ProcessEnv) => DragonCodeConfig | null = dragonCodeConfig,
): ImageProvider {
  const configOf = (env?: NodeJS.ProcessEnv) => {
    const config = readConfig(env)
    if (!config) throw new ProviderError('INVALID_KEY', '尚未配置 DragonCode API Key', false, 503)
    return config
  }

  return {
    id: 'dragoncode',
    capabilities(): ProviderCapabilities {
      return {
        ...DRAGONCODE_CAPABILITIES,
        operations: [...DRAGONCODE_CAPABILITIES.operations],
        ratios: [...DRAGONCODE_CAPABILITIES.ratios],
        resolutions: [...DRAGONCODE_CAPABILITIES.resolutions],
      }
    },
    configured(env?: NodeJS.ProcessEnv) {
      return readConfig(env) !== null
    },
    mapRequest(req: NormalizedImageRequest, model: string) {
      return mapDragonCodeRequest(req, model)
    },
    async submit(input: ProviderSubmitInput, ctx: ProviderContext) {
      const config = configOf()
      const body = {
        model: input.model || config.model,
        prompt: input.prompt,
        n: 1,
        size: input.providerParams.size,
        resolution: input.providerParams.resolution,
        ...(input.images.length ? { image_urls: input.images.map(image => image.url) } : {}),
      }
      const { payload } = await fetchJson(`${config.baseUrl}/images/generations`, {
        method: 'POST',
        headers: headers(config.apiKey),
        body: JSON.stringify(body),
      }, ctx, { timeoutMs: config.requestTimeoutMs, retryCount: config.retryCount, label: 'dragoncode-submit' })
      if (readCode(payload) !== 200) {
        throw dragonCodeFailure(readErrorMessage(payload), payload)
      }
      const taskId = readSubmitTaskId(payload)
      if (!taskId) {
        ctx.log({ stage: 'dragoncode-submit', host: requestHost(config.baseUrl), payload: sanitizePayload(payload) })
        throw missingTaskError()
      }
      return { providerTaskId: taskId }
    },
    async getStatus(providerTaskId: string, ctx: ProviderContext): Promise<ProviderTaskState> {
      const config = configOf()
      const { payload } = await fetchJson(
        `${config.baseUrl}/tasks/${encodeURIComponent(providerTaskId)}`,
        { headers: headers(config.apiKey) },
        ctx,
        { timeoutMs: config.requestTimeoutMs, retryCount: config.retryCount, label: 'dragoncode-status' },
      )
      if (readCode(payload) !== 200) {
        throw dragonCodeFailure(readErrorMessage(payload), payload)
      }
      const data = readStatusPayload(payload)
      const status = asString(data?.status) ?? 'unknown'
      const progress = typeof data?.progress === 'number' ? data.progress : undefined
      if (status === 'completed' || status === 'succeeded') {
        const resultUrls = data ? readResultUrls(data) : []
        if (!resultUrls.length) {
          ctx.log({ stage: 'dragoncode-status', raw: status, payload: sanitizePayload(payload) })
          throw dragonCodeFailure('图片服务没有返回结果地址', payload)
        }
        return { state: 'succeeded', resultUrls }
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        ctx.log({ stage: 'dragoncode-status', raw: status, payload: sanitizePayload(payload) })
        const failure = dragonCodeFailure(readErrorMessage(payload, data), payload)
        return { state: 'failed', code: failure.code, message: failure.message, retryable: failure.retryable }
      }
      return { state: 'processing', progress, raw: status }
    },
    fetchResult(url: string, ctx: ProviderContext) {
      return fetchImageBytes(url, ctx, readConfig()?.requestTimeoutMs ?? 30_000)
    },
  }
}

export const dragonCodeProvider = createDragonCodeProvider()

export function dragonCodeConfigured(env: NodeJS.ProcessEnv = process.env) {
  return isDragonCodeConfigured(env)
}
