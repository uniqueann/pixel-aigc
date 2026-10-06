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
import {
  DEFAULT_INITIAL_POLL_DELAY_MS,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_TASK_TIMEOUT_MS,
  dragonCodeConfig,
  isDragonCodeConfigured,
  type DragonCodeConfig,
} from './config.js'
import {
  asString,
  dragonCodeFailure,
  mapDragonCodeHttpError,
  missingTaskError,
  readNumericCode,
  readResultUrls,
  readStatusData,
  readSubmitTaskId,
  readVendorUsage,
  redactSensitive,
  sanitizePayload,
  sanitizeProviderError,
} from './errors.js'
import { assertReferenceImageUrl, describeReferenceUrl } from './images.js'
import { DRAGONCODE_CAPABILITIES, mapDragonCodeRequest } from './mapping.js'

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
}

async function dragonCodeJson(
  url: string,
  init: RequestInit,
  ctx: ProviderContext,
  config: DragonCodeConfig,
  label: string,
) {
  try {
    return await fetchJson(url, init, ctx, {
      timeoutMs: config.requestTimeoutMs,
      retryCount: config.retryCount,
      label,
    })
  } catch (error) {
    if (error instanceof ProviderError) throw sanitizeProviderError(error)
    throw error
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
    jobPolicy(env?: NodeJS.ProcessEnv) {
      const config = readConfig(env)
      return {
        taskTimeoutMs: config?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS,
        pollIntervalMs: config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
        initialPollDelayMs: config?.initialPollDelayMs ?? DEFAULT_INITIAL_POLL_DELAY_MS,
        maxParallel: config?.maxParallel ?? 4,
      }
    },
    async submit(input: ProviderSubmitInput, ctx: ProviderContext) {
      const config = configOf()
      for (const image of input.images) {
        assertReferenceImageUrl(image.url)
        ctx.log({ stage: 'dragoncode-source', ...describeReferenceUrl(image.url) })
      }
      const body = {
        model: input.model || config.model,
        prompt: input.prompt,
        n: 1,
        size: input.providerParams.size,
        resolution: input.providerParams.resolution,
        ...(input.images.length ? { image_urls: input.images.map(image => image.url) } : {}),
      }
      const { payload, upstreamRequestId } = await dragonCodeJson(
        `${config.baseUrl}/images/generations`,
        { method: 'POST', headers: headers(config.apiKey), body: JSON.stringify(body) },
        ctx,
        config,
        'dragoncode-submit',
      )
      ctx.log({
        stage: 'dragoncode-submit-body',
        host: requestHost(config.baseUrl),
        upstreamRequestId,
        payload: sanitizePayload(payload),
      })
      const numericCode = readNumericCode(payload)
      if (numericCode !== undefined && numericCode !== 200) {
        throw mapDragonCodeHttpError(numericCode, payload)
      }
      const taskId = readSubmitTaskId(payload)
      if (!taskId) {
        throw missingTaskError()
      }
      return { providerTaskId: taskId }
    },
    async getStatus(providerTaskId: string, ctx: ProviderContext): Promise<ProviderTaskState> {
      const config = configOf()
      const { payload, upstreamRequestId } = await dragonCodeJson(
        `${config.baseUrl}/tasks/${encodeURIComponent(providerTaskId)}`,
        { headers: headers(config.apiKey) },
        ctx,
        config,
        'dragoncode-status',
      )
      const numericCode = readNumericCode(payload)
      if (numericCode !== undefined && numericCode !== 200) {
        throw mapDragonCodeHttpError(numericCode, payload)
      }
      const data = readStatusData(payload)
      const status = asString(data?.status) ?? 'unknown'
      const progress = typeof data?.progress === 'number' ? data.progress : undefined
      const vendor = readVendorUsage(data)
      // estimated_time 实测恒为 100，忽略。
      if (status === 'completed' || status === 'succeeded') {
        const resultUrls = data ? readResultUrls(data) : []
        if (!resultUrls.length) {
          ctx.log({ stage: 'dragoncode-status', raw: status, upstreamRequestId, payload: sanitizePayload(payload) })
          throw dragonCodeFailure('图片服务没有返回结果地址', payload)
        }
        ctx.log({
          stage: 'dragoncode-status',
          raw: status,
          progress,
          upstreamRequestId,
          vendor,
          resultCount: resultUrls.length,
          payload: sanitizePayload(payload),
        })
        return { state: 'succeeded', resultUrls, vendor }
      }
      if (status === 'failed' || status === 'error' || status === 'cancelled') {
        const rawMessage = data && typeof data.error === 'object' && data.error
          ? asString((data.error as { message?: unknown }).message) ?? ''
          : ''
        ctx.log({
          stage: 'dragoncode-status',
          raw: status,
          upstreamRequestId,
          vendor,
          rawMessage: rawMessage ? redactSensitive(rawMessage).slice(0, 800) : rawMessage,
          payload: sanitizePayload(payload),
        })
        const failure = dragonCodeFailure(rawMessage, payload, { taskFailed: true })
        return { state: 'failed', code: failure.code, message: failure.message, retryable: failure.retryable, vendor }
      }
      return { state: 'processing', progress, raw: status, vendor }
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
