import { Agent, fetch as undiciFetch } from 'undici'
import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import {
  connectRetryDelay,
  dashScopeHost,
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
  qwenForcedThrottle,
  resolveQwenEnableThinking,
  type QwenImageSettings,
} from './config.js'
import { asFiniteNumber, asString, connectErrorLogFields, isPreSendConnectError, isRecord, mapQwenFailure, readRequestCode } from './errors.js'
import { QWEN_IMAGE_CAPABILITIES, mapQwenImageRequest, parseQwenSize } from './mapping.js'

export const QWEN_GENERATION_PATH = '/api/v1/services/aigc/image-generation/generation'

const qwenAgents = new Map<number, Agent>()

export function qwenAgentOptions(connectTimeoutMs: number) {
  return { connectTimeout: connectTimeoutMs, headersTimeout: 40_000, bodyTimeout: 40_000 }
}

/** 测试注入的 fetch 原样使用。生产路径用千问自己的建连超时，不改消除/重绘/扩图的 4 秒。 */
export function selectQwenFetch(ctxFetch: typeof fetch, connectTimeoutMs: number): typeof fetch {
  if (ctxFetch !== globalThis.fetch) return ctxFetch
  let agent = qwenAgents.get(connectTimeoutMs)
  if (!agent) {
    agent = new Agent(qwenAgentOptions(connectTimeoutMs))
    qwenAgents.set(connectTimeoutMs, agent)
  }
  return (input, init) => undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...(init as object), dispatcher: agent } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>
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
  const before = urls.length
  if (typeof value === 'string' && value.trim()) urls.push(value.trim())
  else if (Array.isArray(value)) {
    for (const item of value) if (typeof item === 'string' && item.trim()) urls.push(item.trim())
  }
  return urls.length > before
}

export type QwenImageShape = 'choices-content-image' | 'choices-content-url' | 'output-results' | 'data'

/**
 * n>1 的异步响应文档只给了单张示例。按文档结构收集：
 * 每个 choice 的 content[].image（字符串或字符串数组），再回退 content[].url、results[].url 与 data[].url。
 * shape 记进状态日志，用来区分排队样本里实际命中了哪一段。
 */
export function readQwenImageUrls(payload: unknown): { urls: string[]; shape?: QwenImageShape } {
  const urls: string[] = []
  let sawImage = false
  let sawContentUrl = false
  const root = isRecord(payload) ? payload : undefined
  const output = root && isRecord(root.output) ? root.output : undefined
  const choices = Array.isArray(output?.choices) ? output.choices : Array.isArray(root?.choices) ? root.choices : []
  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message) || !Array.isArray(choice.message.content)) continue
    for (const part of choice.message.content) {
      if (!isRecord(part)) continue
      if (part.image) sawImage = pushUrl(urls, part.image) || sawImage
      else if (pushUrl(urls, part.url)) sawContentUrl = true
    }
  }
  if (urls.length) {
    let shape: QwenImageShape | undefined
    if (sawImage) shape = 'choices-content-image'
    else if (sawContentUrl) shape = 'choices-content-url'
    return { urls, shape }
  }
  if (output && Array.isArray(output.results)) {
    for (const item of output.results) {
      if (isRecord(item)) pushUrl(urls, item.url)
    }
    if (urls.length) return { urls, shape: 'output-results' }
  }
  if (root && Array.isArray(root.data)) {
    for (const item of root.data) {
      if (isRecord(item)) pushUrl(urls, item.url)
    }
    if (urls.length) return { urls, shape: 'data' }
  }
  return { urls }
}

export function readQwenTimings(payload: unknown) {
  const output = isRecord(payload) && isRecord(payload.output) ? payload.output : undefined
  return {
    submitTime: output ? asString(output.submit_time) : undefined,
    scheduledTime: output ? asString(output.scheduled_time) : undefined,
    endTime: output ? asString(output.end_time) : undefined,
  }
}

export function readQwenTaskMeta(payload: unknown, imageShape?: QwenImageShape): ProviderVendorUsage | undefined {
  const usage = readQwenUsage(payload)
  const timings = readQwenTimings(payload)
  const vendor: ProviderVendorUsage = {
    ...(usage ?? {}),
    ...(timings.submitTime ? { submitTime: timings.submitTime } : {}),
    ...(timings.scheduledTime ? { scheduledTime: timings.scheduledTime } : {}),
    ...(timings.endTime ? { endTime: timings.endTime } : {}),
    ...(imageShape ? { imageShape } : {}),
  }
  if (!usage && !vendor.submitTime && !vendor.scheduledTime && !vendor.endTime && !vendor.imageShape) return undefined
  return vendor
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
  const fetchImpl = selectQwenFetch(ctx.fetch, settings.connectTimeoutMs)
  let lastError: unknown
  for (let attempt = 0; attempt <= settings.retryCount; attempt += 1) {
    const started = ctx.now()
    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: ctx.signal ?? AbortSignal.timeout(settings.requestTimeoutMs),
      })
      const payload = await readPayload(response)
      const requestCode = readRequestCode(payload)
      const requestError = !response.ok || requestLevelError(payload)
      const mapped = requestError
        ? mapQwenFailure(response.status, requestCode.code, requestCode.message)
        : undefined
      // 瞬时限流不在这次请求里睡。浏览器大约 55 秒就放弃 POST，Pro 也经不起 1 秒、2 秒连打。
      const retry = !!mapped?.retryable && !mapped.holdPending && attempt < settings.retryCount
      ctx.log({
        stage: label,
        attempt,
        status: response.status,
        retry,
        host: requestHost(url) ?? dashScopeHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
        ...(requestCode.code ? { upstreamCode: requestCode.code } : {}),
        ...(requestCode.message ? { upstreamMessage: requestCode.message.slice(0, 300) } : {}),
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
        if (error.retryable && !error.holdPending && attempt < settings.retryCount) {
          await ctx.sleep(retryBackoffMs(attempt))
          continue
        }
        throw error
      }
      const preSend = isPreSendConnectError(error)
      const timeout = !preSend && isAbortOrTimeout(error)
      const connect = isTransientConnectError(error)
      // 提交的建连重试最多一次。两次 10 秒建连仍短于 30 秒租约，避免轮询重入时再发一单。
      const budget = label === 'qwen-image-submit' && preSend ? Math.min(settings.retryCount, 1) : settings.retryCount
      const retry = (timeout || connect) && attempt < budget
      ctx.log({
        stage: label,
        attempt,
        retry,
        host: requestHost(url) ?? dashScopeHost(url),
        ms: ctx.now() - started,
        requestId: ctx.requestId,
        ...connectErrorLogFields(error),
      })
      if (retry) {
        await ctx.sleep(connect ? connectRetryDelay(attempt) : retryBackoffMs(attempt))
        continue
      }
      if (preSend) {
        const failure = new ProviderError('UPSTREAM_UNAVAILABLE', '文生图服务连接失败，请稍后重试', true, 502)
        failure.requestSent = false
        throw failure
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
      enable_thinking: resolveQwenEnableThinking(settings, input.providerParams.enableThinking === true),
      watermark: false,
    },
  }
}

function failedTask(payload: unknown): ProviderTaskState {
  const { code, message } = readRequestCode(payload)
  const status = taskStatus(payload)
  const vendor = readQwenTaskMeta(payload)
  if (status === 'CANCELED') {
    return { state: 'failed', code: 'UNKNOWN', message: '图片任务已取消', retryable: false, vendor }
  }
  const failure = mapQwenFailure(200, code, message)
  // 任务已经 FAILED，再查也不会成功。HTTP 5xx 才在 qwenCall 里重试。
  return {
    state: 'failed',
    code: failure.code,
    message: failure.message,
    retryable: false,
    vendor,
  }
}

function logTask(ctx: ProviderContext, payload: unknown, status: string, imageShape?: QwenImageShape, resultCount?: number) {
  const timings = readQwenTimings(payload)
  const usage = readQwenUsage(payload)
  ctx.log({
    stage: 'qwen-image-status',
    raw: status,
    ...(resultCount !== undefined ? { resultCount } : {}),
    ...(imageShape ? { imageShape } : {}),
    ...(timings.submitTime ? { submitTime: timings.submitTime } : {}),
    ...(timings.scheduledTime ? { scheduledTime: timings.scheduledTime } : {}),
    ...(timings.endTime ? { endTime: timings.endTime } : {}),
    ...(usage?.outputImageCount !== undefined ? { outputImageCount: usage.outputImageCount } : {}),
    ...(usage?.outputImageType ? { outputImageType: usage.outputImageType } : {}),
  })
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
      const forced = qwenForcedThrottle()
      if (forced) {
        const upstreamCode = forced === 'quota' ? 'Throttling.AllocationQuota' : 'Throttling.RateQuota'
        const upstreamMessage = forced === 'quota'
          ? 'Allocated quota exceeded, please increase your quota limit.'
          : 'Requests rate limit exceeded.'
        ctx.log({
          stage: 'qwen-image-submit',
          status: 429,
          retry: false,
          forcedThrottle: forced,
          upstreamCode,
          upstreamMessage,
          host: dashScopeHost(settings.baseUrl),
          requestId: ctx.requestId,
        })
        throw mapQwenFailure(429, upstreamCode, upstreamMessage)
      }
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
      ctx.log({
        stage: 'qwen-image-submit',
        host: dashScopeHost(settings.baseUrl),
        taskId: id,
        n: body.parameters.n,
        status,
        enableThinking: body.parameters.enable_thinking,
        promptExtend: body.parameters.prompt_extend,
      })
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
      const parsed = status === 'SUCCEEDED' ? readQwenImageUrls(payload) : undefined
      const vendor = readQwenTaskMeta(payload, parsed?.shape)
      logTask(ctx, payload, status, parsed?.shape, parsed?.urls.length)
      if (status === 'PENDING') return { state: 'queued', raw: status, vendor }
      if (status === 'RUNNING' || status === 'UNKNOWN') return { state: 'processing', raw: status, vendor }
      if (status === 'SUCCEEDED') {
        const resultUrls = parsed?.urls ?? []
        if (!resultUrls.length) {
          return { state: 'failed', code: 'BAD_RESPONSE', message: '图片服务没有返回结果地址', retryable: false, vendor }
        }
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
