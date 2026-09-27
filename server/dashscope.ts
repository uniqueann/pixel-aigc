import sharp from 'sharp'
import { Agent, fetch as undiciFetch } from 'undici'
import { describeError, HttpError } from './errors.js'

export const CONNECT_TIMEOUT_MS = 4_000
export const SUBMIT_ATTEMPTS = 3
export const GET_ATTEMPTS = 3
/** 整次墙钟预算，给下载/后处理留出 maxDuration 120s 的余量。 */
export const DEFAULT_DEADLINE_MS = 90_000
/** 轮询停止后留给下载、裁切/缩放和下一 pass 的余量。 */
export const FINISH_RESERVE_MS = 20_000
/** 防止 now() 不前进时死循环；正常路径靠截止时间停。 */
export const MAX_POLLS = 200

export const SYNTHESIS_PATH = '/api/v1/services/aigc/image2image/image-synthesis'

const dashScopeDispatcher = new Agent({
  connectTimeout: CONNECT_TIMEOUT_MS,
  headersTimeout: 20_000,
  bodyTimeout: 30_000,
})

export interface BailianConfig {
  apiKey: string
  baseUrl: string
}

export type DashScopeLog = (entry: Record<string, unknown>) => void

export interface BailianResult {
  url?: string
  code?: string
  message?: string
}

export interface BailianPayload {
  code?: string
  message?: string
  output?: {
    task_id?: string
    task_status?: string
    results?: BailianResult[]
    output_image_url?: string
    code?: string
    message?: string
  }
}

export function bailianConfig(env: NodeJS.ProcessEnv = process.env): BailianConfig | null {
  const apiKey = env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) return null
  const baseUrl = (env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com').replace(/\/$/, '')
  return { apiKey, baseUrl }
}

/** 只记 host，不把完整 URL 或 Key 打进日志。 */
export function dashScopeHost(baseUrl: string) {
  try {
    return new URL(baseUrl).host
  } catch {
    return null
  }
}

/** 先密后疏，随后回到 1–2s，避免固定 30 次就把还在跑的任务掐掉。 */
export function dashScopePollDelay(attempt: number): number {
  if (attempt <= 0) return 400
  if (attempt < 8) return 800
  if (attempt < 20) return 1_200
  return 2_000
}

/** 本 pass 的等待截止：从剩余墙钟里扣掉收尾余量，再按未完成 pass 均分。 */
export function passWaitDeadline(
  now: number,
  overallDeadline: number,
  remainingPasses: number,
  reserveMs = FINISH_RESERVE_MS,
) {
  const remaining = overallDeadline - now - reserveMs
  const slices = Math.max(1, remainingPasses)
  return now + Math.max(0, Math.floor(remaining / slices))
}

export function connectRetryDelay(attempt: number): number {
  return attempt <= 0 ? 250 : 500
}

/** 仅连接层失败可重试。已收到 HTTP 响应，或请求已被 AbortSignal 取消，都不算。 */
export function isTransientConnectError(error: unknown): boolean {
  const codes = new Set<string>()
  const texts: string[] = []
  let current: unknown = error
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      const code = 'code' in current && typeof current.code === 'string' ? current.code : ''
      if (code) codes.add(code)
      texts.push(current.name, current.message)
      current = current.cause
    } else {
      texts.push(String(current))
      break
    }
  }
  const text = `${[...codes].join(' ')} ${texts.join(' ')}`
  if ((codes.has('ABORT_ERR') || /AbortError|TimeoutError|The operation was aborted/i.test(text)
    || codes.has('UND_ERR_HEADERS_TIMEOUT')
    || codes.has('UND_ERR_BODY_TIMEOUT')
    || codes.has('UND_ERR_RESPONSE_TIMEOUT')
    || /UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_RESPONSE_TIMEOUT/i.test(text))
    && !/ConnectTimeout|UND_ERR_CONNECT_TIMEOUT/i.test(text)) {
    return false
  }
  return codes.has('UND_ERR_CONNECT_TIMEOUT')
    || codes.has('UND_ERR_SOCKET')
    || codes.has('ECONNRESET')
    || codes.has('ETIMEDOUT')
    || codes.has('ENOTFOUND')
    || codes.has('EAI_AGAIN')
    || codes.has('ECONNREFUSED')
    || codes.has('EPIPE')
    || codes.has('EHOSTUNREACH')
    || /ConnectTimeoutError|UND_ERR_CONNECT_TIMEOUT|ECONNRESET|ETIMEDOUT|socket hang up|fetch failed/i.test(text)
}

export function defaultDashScopeFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...(init as object), dispatcher: dashScopeDispatcher } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>
}

export function createDashScopeLog(evt: string): DashScopeLog {
  return (entry) => {
    if (process.env.VITEST) return
    console.info(JSON.stringify({
      evt,
      region: process.env.VERCEL_REGION ?? null,
      ...entry,
    }))
  }
}

export function dashScopeErrorFields(payload: BailianPayload) {
  const result = payload.output?.results?.find(item => item.code || item.message)
  return {
    code: payload.code || payload.output?.code || result?.code || null,
    message: payload.message || payload.output?.message || result?.message || null,
  }
}

export function dashScopeFailureText(code: string, message: string, kind: string) {
  const detail = message.replace(/\s+/g, ' ').trim().slice(0, 180)
  const combined = `${code} ${message}`
  if (code === 'InvalidApiKey' || /invalid api-?key|no api-key/i.test(combined)) return '阿里云百炼 API Key 无效'
  if (code === 'Arrearage' || /欠费|arrearage|overdue/i.test(combined)) return '阿里云百炼账户已欠费，请充值后再试'
  if (code === 'InvalidParameter.FileDownload') return `${kind}服务无法读取这张图片`
  if (code === 'InvalidParameter.ImageFormat') return `这张图片的格式不受${kind}服务支持`
  if (code === 'DataInspectionFailed' || code === 'InvalidParameter.ImageContent' || code === 'InvalidParameter.DataInspection') {
    return '这张图片没有通过内容审核'
  }
  if (code === 'IPInfringementSuspect') return `这张图片可能涉及侵权，无法${kind}`
  if (/string index out of range|IndexError/i.test(combined)) {
    return `${kind}服务没有读到有效参数，请重新涂抹后重试`
  }
  if (code === 'InvalidParameter') return detail ? `${kind}参数超出服务限制：${detail}` : `${kind}参数超出服务限制`
  if (code.startsWith('InternalError')) return `${kind}服务暂时不可用，请稍后重试`
  return detail ? `${kind}失败：${detail}` : `${kind}失败`
}

export function dashScopePayloadError(payload: BailianPayload, kind: string, errorCode: string) {
  const { code, message } = dashScopeErrorFields(payload)
  if (!code && !message) return null
  return new HttpError(502, dashScopeFailureText(code ?? '', message ?? '', kind), errorCode)
}

export async function readJson(response: Response) {
  return await response.json().catch(() => ({})) as BailianPayload
}

export async function callDashScope(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  stage: string,
  attempts: number,
  abortMs: number,
  sleep: (ms: number) => Promise<void>,
  log: DashScopeLog,
  extra: Record<string, unknown> & { now: () => number },
  connectMessage: string,
  errorCode: string,
) {
  const { now, ...rest } = extra
  let lastError: unknown
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const started = now()
    try {
      return await fetchImpl(input, { ...init, signal: AbortSignal.timeout(abortMs) })
    } catch (error) {
      lastError = error
      const details = describeError(error)
      const retry = isTransientConnectError(error) && attempt < attempts
      log({
        stage, attempt, attempts, retry,
        error: details.message, cause: details.cause ?? null,
        ms: now() - started, ...rest,
      })
      if (!retry) {
        throw new HttpError(502, connectMessage, errorCode, { cause: error, stage })
      }
      await sleep(connectRetryDelay(attempt - 1))
    }
  }
  throw new HttpError(502, connectMessage, errorCode, { cause: lastError, stage })
}

export function resultImageUrl(payload: BailianPayload) {
  return payload.output?.results?.find(item => item.url)?.url || payload.output?.output_image_url || ''
}

export async function encodeJpegForDashScope(
  image: Buffer,
  width: number,
  height: number,
  limitMessage: string,
) {
  const meta = await sharp(image, { failOn: 'none' }).metadata()
  if (
    (meta.orientation ?? 1) <= 1
    && meta.format === 'jpeg'
    && meta.width === width
    && meta.height === height
    && image.length <= 9_000_000
  ) {
    return image
  }
  let quality = 90
  let encoded = await sharp(image, { failOn: 'none' }).rotate().resize(width, height, { fit: 'fill' }).jpeg({ quality }).toBuffer()
  while (encoded.length > 9_000_000 && quality > 60) {
    quality -= 10
    encoded = await sharp(image, { failOn: 'none' }).rotate().resize(width, height, { fit: 'fill' }).jpeg({ quality }).toBuffer()
  }
  if (encoded.length > 10_000_000) throw new HttpError(413, limitMessage)
  return encoded
}

export interface DashScopeImageTaskOptions {
  config: BailianConfig
  body: unknown
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  deadline: number
  remainingPasses: number
  requestId?: string
  log: DashScopeLog
  pass: number
  extraSubmitLog?: Record<string, unknown>
  kind: string
  errorCode: string
  timeoutCode: string
  timeoutMessage: string
  connectMessage: string
  payloadError?: (payload: BailianPayload) => HttpError | null
}

/** 异步提交 + 按剩余墙钟轮询 + 下载结果图。扩图和消除共用。 */
export async function submitDashScopeImageTask(options: DashScopeImageTaskOptions) {
  const headers = {
    Authorization: `Bearer ${options.config.apiKey}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  }
  const submitStarted = options.now()
  const created = await callDashScope(options.fetch, `${options.config.baseUrl}${SYNTHESIS_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(options.body),
  }, 'submit', SUBMIT_ATTEMPTS, 20_000, options.sleep, options.log, {
    requestId: options.requestId, pass: options.pass, host: dashScopeHost(options.config.baseUrl), now: options.now,
    ...options.extraSubmitLog,
  }, options.connectMessage, options.errorCode)
  const createdPayload = await readJson(created)
  options.log({
    requestId: options.requestId, stage: 'submit', pass: options.pass, ms: options.now() - submitStarted,
    status: created.status, taskId: createdPayload.output?.task_id ?? null,
    host: dashScopeHost(options.config.baseUrl),
    ...options.extraSubmitLog,
  })
  const payloadError = options.payloadError ?? ((payload: BailianPayload) => dashScopePayloadError(payload, options.kind, options.errorCode))
  if (!created.ok) throw payloadError(createdPayload) ?? new HttpError(502, `${options.kind}任务提交失败`, options.errorCode)
  const failed = payloadError(createdPayload)
  if (failed && !createdPayload.output?.task_id) throw failed
  const taskId = createdPayload.output?.task_id
  if (!taskId) throw new HttpError(502, `${options.kind}服务没有返回任务编号`, options.errorCode)

  const waitStarted = options.now()
  const waitDeadline = passWaitDeadline(waitStarted, options.deadline, options.remainingPasses)
  let imageUrl = ''
  let polls = 0
  while (polls < MAX_POLLS) {
    const delay = dashScopePollDelay(polls)
    if (options.now() + delay > waitDeadline) break
    await options.sleep(delay)
    if (options.now() > waitDeadline) break
    const pollStarted = options.now()
    const polled = await callDashScope(options.fetch, `${options.config.baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${options.config.apiKey}` },
    }, 'poll', GET_ATTEMPTS, 20_000, options.sleep, options.log, {
      requestId: options.requestId, pass: options.pass, poll: polls, now: options.now,
    }, options.connectMessage, options.errorCode)
    const payload = await readJson(polled)
    const status = payload.output?.task_status
    const failure = dashScopeErrorFields(payload)
    polls += 1
    options.log({
      requestId: options.requestId, stage: 'poll', pass: options.pass, attempt: polls - 1, status: status ?? null,
      ms: options.now() - pollStarted, waitMs: options.now() - waitStarted, delayMs: delay, taskId,
      ...(status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN'
        ? { code: failure.code, message: failure.message }
        : {}),
    })
    if (!polled.ok) throw payloadError(payload) ?? new HttpError(502, `${options.kind}结果查询失败`, options.errorCode)
    if (status === 'SUCCEEDED') {
      imageUrl = resultImageUrl(payload)
      if (!imageUrl) throw payloadError(payload) ?? new HttpError(502, `${options.kind}没有返回图片`, options.errorCode)
      break
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw payloadError(payload) ?? new HttpError(502, `${options.kind}失败`, options.errorCode)
    }
  }
  options.log({
    requestId: options.requestId, stage: 'wait', pass: options.pass, ms: options.now() - waitStarted, polls,
    done: Boolean(imageUrl), taskId, waitDeadline,
  })
  if (!imageUrl) {
    throw new HttpError(504, options.timeoutMessage, options.timeoutCode, { stage: 'wait' })
  }
  const downloadStarted = options.now()
  const downloaded = await callDashScope(options.fetch, imageUrl, undefined, 'download', GET_ATTEMPTS, 30_000, options.sleep, options.log, {
    requestId: options.requestId, pass: options.pass, now: options.now,
  }, options.connectMessage, options.errorCode)
  if (!downloaded.ok) throw new HttpError(502, `${options.kind}结果下载失败`, options.errorCode)
  const buffer = Buffer.from(await downloaded.arrayBuffer())
  options.log({
    requestId: options.requestId, stage: 'download', pass: options.pass, ms: options.now() - downloadStarted, bytes: buffer.length,
  })
  return buffer
}
