import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import {
  connectRetryDelay,
  dashScopeHost,
  defaultDashScopeFetch,
  isTransientConnectError,
} from '../../dashscope.js'
import { fetchImageBytes, isAbortOrTimeout, requestHost, retryBackoffMs } from '../http.js'
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
  DEFAULT_QWEN_INITIAL_POLL_DELAY_MS,
  DEFAULT_QWEN_POLL_INTERVAL_MS,
  DEFAULT_QWEN_TASK_TIMEOUT_MS,
  qwenImageEnabled,
  qwenImageSettings,
  type QwenImageSettings,
} from './config.js'
import { asFiniteNumber, asString, isRecord, mapQwenFailure, readRequestCode } from './errors.js'
import { QWEN_IMAGE_CAPABILITIES, mapQwenImageRequest, parseQwenSize } from './mapping.js'

export const QWEN_GENERATION_PATH = '/api/v1/services/aigc/image-generation/generation'

function resolveFetch(ctx: ProviderContext): typeof fetch {
  return ctx.fetch === globalThis.fetch ? defaultDashScopeFetch : ctx.fetch
}

function taskStatus(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.output)) return undefined
  return asString(payload.output.task_status)
}

function taskId(payload: unknown) {
  if (!isRecord(payload) || !isRecord(payload.output)) return undefined
  return asString(payload.output.task_id)
}

function pushUrl(urls: string[], value: unknown) {
  if (typeof value === 'string' && value.trim()) urls.push(value.trim())
  else if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string' && item.trim()) urls.push(item.trim())
  }
}

/**
 * n>1 的异步响应文档只给了单张示例。按文档结构收集：
 * 每个 choice 的 content[].image（字符串或字符串数组），再回退 results[].url 与 data[].url。
 */
export function readQwenImageUrls(payload: unknown) {
  const urls: string[] = []
  const root = isRecord(payload) ? payload : undefined
  const output = root && isRecord(root.output) ? root.output : undefined
  const choices = Array.isArray(output?.choices) ? output.choices : Array.isArray(root?.choices) ? root.choices : []
  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.content)) continue
    for (const part of choice.message.content) {
      if (!isRecord(part)) continue
      pushUrl(urls, part.image)
      if (!part.image) pushUrl(urls, part.url)
    }
  }
  if (!urls.length && output && Array.isArray(output.results)) {
    for (const item of output.results) {
      if (isRecord(item)) pushUrl(urls, item.url)
    }
  }
  if (!urls.length && root && Array.isArray(root.data)) {
    for (const item of root.data) {
      if (isRecord(item)) pushUrl(urls, item.url)
    }
  }
  return urls
}

export function readQwenUsage(payload: unknown): ProviderVendorUsage | undefined {
  if (!isRecord(payload) || !isRecord(payload.usage)) return undefined
  const usage = payload.usage
  const outputWidth = asFiniteNumber(usage.output_width)
  const outputHeight = asFiniteNumber(usage.output_height)
  const outputImageCount = asFiniteNumber(usage.output_image_count)
  const outputImageType = asString(usage.output_image_type)
  if (outputWidth === undefined && outputHeight === undefined && outputImageCount === undefined && !outputImageType) {
    return undefined
  }
  return { outputWidth, outputHeight, outputImageCount, outputImageType }
}

function requestLevelError(payload: unknown) {
  if (!isRecord(payload) || taskStatus(payload)) return false
  return Boolean(asString(payload.code))
}

async function readPayload(response: Response) {
  return await response.json().catch(() => ({})) as unknown
}

async function qwenCall(
  url: string,
  init: RequestInit,
  ctx: ProviderContext,
  settings: QwenImageSettings,
  label: string,
) {
  const fetchImpl = resolveFetch(ctx)
  let lastError: unknown
  for (let attempt = 0; attempt <= settings.retryCount; attempt += 1) {
    const started = ctx.now()
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: ctx.signal ?? AbortSignal.timeout(settings.requestTimeoutMs),
      })
      const payload = await readPayload(response)
      const requestError = !response.ok || requestLevelError(payload)
      const mapped = requestError
        ? mapQwenFailure(response.status, readRequestCode(payload).code, readRequestCode(payload).message)
        : undefined
      const retry = !!mapped?.retryable && attempt < settings.retryCount
      ctx.log({
        stage: label,
        attempt,
        status: response.status,
        retry,
        host: requestHost(url) ?? dashScopeHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
      })
      if (retry) {
        await ctx.sleep(retryBackoffMs(attempt))
        continue
      }
      if (mapped) throw mapped
      return payload
    } catch (error) {
      lastError = error
      if (error instanceof ProviderError) {
        if (error.retryable && attempt < settings.retryCount) {
          await ctx.sleep(retryBackoffMs(attempt))
          continue
        }
        throw error
      }
      const timeout = isAbortOrTimeout(error)
      const connect = isTransientConnectError(error)
      const retry = (timeout || connect) && attempt < settings.retryCount
      ctx.log({
        stage: label,
        attempt,
        retry,
        host: requestHost(url) ?? dashScopeHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
        error: error instanceof Error ? error.message : String(error),
      })
      if (retry) {
        await ctx.sleep(connect ? connectRetryDelay(attempt) : retryBackoffMs(attempt))
        continue
      }
      if (timeout) throw new ProviderError('TIMEOUT', '图片服务请求超时，请稍后重试', true, 504)
      throw new ProviderError('UPSTREAM_UNAVAILABLE', '文生图服务连接失败，请稍后重试', true, 502)
    }
  }
  throw lastError instanceof ProviderError
    ? lastError
    : new ProviderError('UPSTREAM_UNAVAILABLE', '文生图服务连接失败，请稍后重试', true, 502)
}

function generationBody(input: ProviderSubmitInput, settings: QwenImageSettings) {
  const size = input.providerParams.size
  if (typeof size !== 'string' || !parseQwenSize(size)) {
    throw new ProviderError('INVALID_PARAMS', '图片尺寸不被支持', false, 400)
  }
  const requested = input.providerParams.n
  const n = Math.min(4, Math.max(1, typeof requested === 'number' && Number.isInteger(requested) ? requested : 1))
  if (!input.prompt.trim()) throw new ProviderError('INVALID_PARAMS', '请填写画面描述', false, 400)
  return {
    model: input.model,
    input: {
      messages: [{ role: 'user', content: [{ text: input.prompt }] }],
    },
    parameters: {
      size,
      n,
      prompt_extend: settings.promptExtend,
      enable_thinking: settings.promptExtend && settings.enableThinking,
      watermark: false,
    },
  }
}

function failedTask(payload: unknown): ProviderTaskState {
  const { code, message } = readRequestCode(payload)
  const status = taskStatus(payload)
  if (status === 'CANCELED') {
    return { state: 'failed', code: 'UNKNOWN', message: '图片任务已取消', retryable: false, vendor: readQwenUsage(payload) }
  }
  const failure = mapQwenFailure(200, code, message)
  // 任务已经 FAILED，再查也不会成功。HTTP 5xx 才在 qwenCall 里重试。
  return {
    state: 'failed',
    code: failure.code,
    message: failure.message,
    retryable: false,
    vendor: readQwenUsage(payload),
  }
}

export function createQwenImageProvider(
  readConfig: (env?: NodeJS.ProcessEnv) => QwenImageSettings | null = qwenImageSettings,
): ImageProvider {
  const settingsOf = (env?: NodeJS.ProcessEnv) => {
    const settings = readConfig(env)
    if (!settings) throw new ProviderError('INVALID_KEY', '尚未配置阿里云百炼 API Key', false, 503)
    return settings
  }

  return {
    id: 'bailian',
    capabilities(): ProviderCapabilities {
      return {
        ...QWEN_IMAGE_CAPABILITIES,
        operations: [...QWEN_IMAGE_CAPABILITIES.operations],
        ratios: [...QWEN_IMAGE_CAPABILITIES.ratios],
        resolutions: [...QWEN_IMAGE_CAPABILITIES.resolutions],
      }
    },
    configured(env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return qwenImageEnabled(env) && !!settings && settings.models.length > 0
    },
    acceptsModel(model: string, env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return qwenImageEnabled(env) && settings?.models.includes(model) === true
    },
    mapRequest(req: NormalizedImageRequest, model: string) {
      return mapQwenImageRequest(req, model)
    },
    jobPolicy(env?: NodeJS.ProcessEnv) {
      const settings = readConfig(env)
      return {
        taskTimeoutMs: settings?.taskTimeoutMs ?? DEFAULT_QWEN_TASK_TIMEOUT_MS,
        pollIntervalMs: settings?.pollIntervalMs ?? DEFAULT_QWEN_POLL_INTERVAL_MS,
        initialPollDelayMs: settings?.initialPollDelayMs ?? DEFAULT_QWEN_INITIAL_POLL_DELAY_MS,
        maxParallel: settings?.maxParallel ?? 1,
      }
    },
    async submit(input: ProviderSubmitInput, ctx: ProviderContext) {
      if (input.images.length) throw new ProviderError('INVALID_PARAMS', '当前模型暂不支持参考图', false, 400)
      const settings = settingsOf()
      const body = generationBody(input, settings)
      const payload = await qwenCall(
        `${settings.baseUrl}${QWEN_GENERATION_PATH}`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${settings.apiKey}`,
            'Content-Type': 'application/json',
            'X-DashScope-Async': 'enable',
          },
          body: JSON.stringify(body),
        },
        ctx,
        settings,
        'qwen-image-submit',
      )
      const status = taskStatus(payload)
      if (status === 'FAILED' || status === 'CANCELED') {
        const failure = failedTask(payload)
        if (failure.state === 'failed') throw new ProviderError(failure.code, failure.message, false, 502)
      }
      const id = taskId(payload)
      if (!id) throw new ProviderError('BAD_RESPONSE', '图片服务没有返回任务编号', false, 502)
      ctx.log({ stage: 'qwen-image-submit', host: dashScopeHost(settings.baseUrl), taskId: id, n: body.parameters.n, status })
      return { providerTaskId: id }
    },
    async getStatus(providerTaskId: string, ctx: ProviderContext): Promise<ProviderTaskState> {
      const settings = settingsOf()
      const payload = await qwenCall(
        `${settings.baseUrl}/api/v1/tasks/${encodeURIComponent(providerTaskId)}`,
        { headers: { Authorization: `Bearer ${settings.apiKey}` } },
        ctx,
        settings,
        'qwen-image-status',
      )
      const status = taskStatus(payload) ?? 'UNKNOWN'
      const vendor = readQwenUsage(payload)
      if (status === 'PENDING') return { state: 'queued', raw: status, vendor }
      if (status === 'RUNNING' || status === 'UNKNOWN') return { state: 'processing', raw: status, vendor }
      if (status === 'SUCCEEDED') {
        const resultUrls = readQwenImageUrls(payload)
        if (!resultUrls.length) {
          return { state: 'failed', code: 'BAD_RESPONSE', message: '图片服务没有返回结果地址', retryable: false, vendor }
        }
        ctx.log({
          stage: 'qwen-image-status',
          raw: status,
          resultCount: resultUrls.length,
          outputImageCount: vendor?.outputImageCount,
          outputImageType: vendor?.outputImageType,
        })
        return { state: 'succeeded', resultUrls, vendor }
      }
      if (status === 'FAILED' || status === 'CANCELED') return failedTask(payload)
      return { state: 'processing', raw: status, vendor }
    },
    fetchResult(url: string, ctx: ProviderContext) {
      return fetchImageBytes(url, ctx, readConfig()?.requestTimeoutMs ?? 30_000)
    },
  }
}

export const qwenImageProvider = createQwenImageProvider()
