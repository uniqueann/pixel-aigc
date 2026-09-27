import sharp from 'sharp'
import { Agent, fetch as undiciFetch } from 'undici'
import { describeError, HttpError } from './errors.js'
import {
  DEFAULT_EXPAND_PROMPT,
  planBailianOutpaint,
  type PixelPadding,
  type BailianExpandScales,
  type BailianOutpaintPlan,
} from '../shared/outpaint.js'

export const CONNECT_TIMEOUT_MS = 4_000
export const SUBMIT_ATTEMPTS = 3
export const GET_ATTEMPTS = 3

const dashScopeDispatcher = new Agent({
  connectTimeout: CONNECT_TIMEOUT_MS,
  headersTimeout: 20_000,
  bodyTimeout: 30_000,
})

export interface BailianConfig {
  apiKey: string
  baseUrl: string
}

export type OutpaintLog = (entry: Record<string, unknown>) => void

interface BailianDeps {
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  deadlineMs?: number
  requestId?: string
  log?: OutpaintLog
}

interface BailianResult {
  url?: string
  code?: string
  message?: string
}

interface BailianPayload {
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

const SYNTHESIS_PATH = '/api/v1/services/aigc/image2image/image-synthesis'

export function bailianConfig(env: NodeJS.ProcessEnv = process.env): BailianConfig | null {
  const apiKey = env.DASHSCOPE_API_KEY?.trim()
  if (!apiKey) return null
  const baseUrl = (env.DASHSCOPE_BASE_URL?.trim() || 'https://dashscope.aliyuncs.com').replace(/\/$/, '')
  return { apiKey, baseUrl }
}

/** 先密后疏：300ms 起轮询，生成窗口内每 500ms 一次，避免固定 1s/1.5s 空等。 */
export function outpaintPollDelay(attempt: number): number {
  if (attempt <= 0) return 300
  if (attempt < 16) return 500
  return 800
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

function defaultFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...(init as object), dispatcher: dashScopeDispatcher } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>
}

function defaultLog(entry: Record<string, unknown>) {
  if (process.env.VITEST) return
  console.info(JSON.stringify({
    evt: 'outpaint',
    region: process.env.VERCEL_REGION ?? null,
    ...entry,
  }))
}

function failureText(code: string, message: string) {
  const detail = message.replace(/\s+/g, ' ').trim().slice(0, 180)
  const combined = `${code} ${message}`
  if (code === 'InvalidApiKey' || /invalid api-?key|no api-key/i.test(combined)) return '阿里云百炼 API Key 无效'
  if (code === 'Arrearage' || /欠费|arrearage|overdue/i.test(combined)) return '阿里云百炼账户已欠费，请充值后再试'
  if (code === 'InvalidParameter.FileDownload') return '扩图服务无法读取这张图片'
  if (code === 'InvalidParameter.ImageFormat') return '这张图片的格式不受扩图服务支持'
  if (code === 'DataInspectionFailed' || code === 'InvalidParameter.ImageContent' || code === 'InvalidParameter.DataInspection') {
    return '这张图片没有通过内容审核'
  }
  if (code === 'IPInfringementSuspect') return '这张图片可能涉及侵权，无法扩展'
  if (code === 'InvalidParameter') return detail ? `扩图参数超出服务限制：${detail}` : '扩图参数超出服务限制'
  if (code.startsWith('InternalError')) return '扩图服务暂时不可用，请稍后重试'
  return detail ? `扩图失败：${detail}` : '扩图失败'
}

function payloadError(payload: BailianPayload) {
  const result = payload.output?.results?.find(item => item.code || item.message)
  const code = payload.code || payload.output?.code || result?.code || ''
  const message = payload.message || payload.output?.message || result?.message || ''
  if (!code && !message) return null
  return new HttpError(502, failureText(code, message), 'OUTPAINT_FAILED')
}

async function readJson(response: Response) {
  return await response.json().catch(() => ({})) as BailianPayload
}

async function callDashScope(
  fetchImpl: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init: RequestInit | undefined,
  stage: string,
  attempts: number,
  abortMs: number,
  sleep: (ms: number) => Promise<void>,
  log: OutpaintLog,
  extra: Record<string, unknown> & { now: () => number },
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
        throw new HttpError(502, '无法连接到阿里云百炼扩图服务，请稍后重试', 'OUTPAINT_FAILED', { cause: error, stage })
      }
      await sleep(connectRetryDelay(attempt - 1))
    }
  }
  throw new HttpError(502, '无法连接到阿里云百炼扩图服务，请稍后重试', 'OUTPAINT_FAILED', { cause: lastError, stage })
}

function resultImageUrl(payload: BailianPayload) {
  return payload.output?.results?.find(item => item.url)?.url || payload.output?.output_image_url || ''
}

async function encodeInput(image: Buffer, width: number, height: number) {
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
  if (encoded.length > 10_000_000) throw new HttpError(413, '图片压缩后仍超过扩图服务的 10 MB 限制')
  return encoded
}

async function encodePassInput(image: Buffer) {
  const meta = await sharp(image, { failOn: 'none' }).metadata()
  if (meta.format === 'jpeg' && image.length <= 9_000_000) return image
  let quality = 90
  let encoded = await sharp(image, { failOn: 'none' }).jpeg({ quality }).toBuffer()
  while (encoded.length > 9_000_000 && quality > 60) {
    quality -= 10
    encoded = await sharp(image, { failOn: 'none' }).jpeg({ quality }).toBuffer()
  }
  if (encoded.length > 10_000_000) throw new HttpError(413, '图片压缩后仍超过扩图服务的 10 MB 限制')
  return encoded
}

export async function cropOutpaintResult(modelImage: Buffer, plan: BailianOutpaintPlan) {
  const meta = await sharp(modelImage, { failOn: 'none' }).metadata()
  const actualWidth = meta.width ?? 0
  const actualHeight = meta.height ?? 0
  if (!actualWidth || !actualHeight) throw new HttpError(502, '扩图结果无法读取', 'OUTPAINT_FAILED')
  const scaleX = actualWidth / plan.modelWidth
  const scaleY = actualHeight / plan.modelHeight
  const left = Math.min(Math.max(0, Math.round(plan.crop.left * scaleX)), actualWidth - 1)
  const top = Math.min(Math.max(0, Math.round(plan.crop.top * scaleY)), actualHeight - 1)
  const width = Math.min(Math.max(1, Math.round(plan.crop.width * scaleX)), actualWidth - left)
  const height = Math.min(Math.max(1, Math.round(plan.crop.height * scaleY)), actualHeight - top)
  return sharp(modelImage, { failOn: 'none' })
    .extract({ left, top, width, height })
    .resize(plan.targetWidth, plan.targetHeight, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer()
}

async function submitExpand(
  config: BailianConfig,
  image: Buffer,
  scales: BailianExpandScales,
  deps: {
    fetch: typeof fetch
    sleep: (ms: number) => Promise<void>
    now: () => number
    deadline: number
    requestId?: string
    log: OutpaintLog
    pass: number
  },
) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  }
  const submitStarted = deps.now()
  const created = await callDashScope(deps.fetch, `${config.baseUrl}${SYNTHESIS_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'wanx2.1-imageedit',
      input: {
        function: 'expand',
        prompt: DEFAULT_EXPAND_PROMPT,
        base_image_url: `data:image/jpeg;base64,${image.toString('base64')}`,
      },
      parameters: {
        left_scale: scales.left,
        right_scale: scales.right,
        top_scale: scales.top,
        bottom_scale: scales.bottom,
        n: 1,
        watermark: false,
      },
    }),
  }, 'submit', SUBMIT_ATTEMPTS, 20_000, deps.sleep, deps.log, {
    requestId: deps.requestId, pass: deps.pass, bytes: image.length, now: deps.now,
  })
  const createdPayload = await readJson(created)
  deps.log({
    requestId: deps.requestId, stage: 'submit', pass: deps.pass, ms: deps.now() - submitStarted,
    bytes: image.length, status: created.status, taskId: createdPayload.output?.task_id ?? null,
  })
  if (!created.ok) throw payloadError(createdPayload) ?? new HttpError(502, '扩图任务提交失败', 'OUTPAINT_FAILED')
  const failed = payloadError(createdPayload)
  if (failed && !createdPayload.output?.task_id) throw failed
  const taskId = createdPayload.output?.task_id
  if (!taskId) throw new HttpError(502, '扩图服务没有返回任务编号', 'OUTPAINT_FAILED')

  const waitStarted = deps.now()
  let imageUrl = ''
  let polls = 0
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (deps.now() > deps.deadline) break
    const delay = outpaintPollDelay(attempt)
    await deps.sleep(delay)
    const pollStarted = deps.now()
    const polled = await callDashScope(deps.fetch, `${config.baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, 'poll', GET_ATTEMPTS, 20_000, deps.sleep, deps.log, {
      requestId: deps.requestId, pass: deps.pass, poll: attempt, now: deps.now,
    })
    const payload = await readJson(polled)
    const status = payload.output?.task_status
    polls += 1
    deps.log({
      requestId: deps.requestId, stage: 'poll', pass: deps.pass, attempt, status: status ?? null,
      ms: deps.now() - pollStarted, waitMs: deps.now() - waitStarted, delayMs: delay,
    })
    if (!polled.ok) throw payloadError(payload) ?? new HttpError(502, '扩图结果查询失败', 'OUTPAINT_FAILED')
    if (status === 'SUCCEEDED') {
      imageUrl = resultImageUrl(payload)
      if (!imageUrl) throw payloadError(payload) ?? new HttpError(502, '扩图没有返回图片', 'OUTPAINT_FAILED')
      break
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw payloadError(payload) ?? new HttpError(502, '扩图失败', 'OUTPAINT_FAILED')
    }
  }
  deps.log({
    requestId: deps.requestId, stage: 'wait', pass: deps.pass, ms: deps.now() - waitStarted, polls, done: Boolean(imageUrl),
  })
  if (!imageUrl) throw new HttpError(504, '扩图超时，请稍后重试', 'OUTPAINT_TIMEOUT')
  const downloadStarted = deps.now()
  const downloaded = await callDashScope(deps.fetch, imageUrl, undefined, 'download', GET_ATTEMPTS, 30_000, deps.sleep, deps.log, {
    requestId: deps.requestId, pass: deps.pass, now: deps.now,
  })
  if (!downloaded.ok) throw new HttpError(502, '扩图结果下载失败', 'OUTPAINT_FAILED')
  const buffer = Buffer.from(await downloaded.arrayBuffer())
  deps.log({
    requestId: deps.requestId, stage: 'download', pass: deps.pass, ms: deps.now() - downloadStarted, bytes: buffer.length,
  })
  return buffer
}

export async function expandWithBailian(image: Buffer, padding: PixelPadding, deps: BailianDeps = {}) {
  const config = bailianConfig(deps.env ?? process.env)
  if (!config) throw new HttpError(503, '智能扩展尚未配置阿里云百炼 API Key', 'OUTPAINT_UNAVAILABLE')
  const fetchImpl = deps.fetch ?? defaultFetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? defaultLog
  const started = now()
  let size: { width?: number; height?: number }
  try {
    size = await sharp(image, { failOn: 'none' }).rotate().metadata()
  } catch {
    throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  }
  if (!size.width || !size.height) throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  let plan: BailianOutpaintPlan
  try {
    plan = planBailianOutpaint(size.width, size.height, padding)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : '扩图参数无效', 'INVALID_OUTPAINT')
  }
  const encodeStarted = now()
  const encoded = await encodeInput(image, plan.inputWidth, plan.inputHeight)
  log({
    requestId: deps.requestId, stage: 'plan',
    sourceWidth: size.width, sourceHeight: size.height,
    inputWidth: plan.inputWidth, inputHeight: plan.inputHeight,
    targetWidth: plan.targetWidth, targetHeight: plan.targetHeight,
    passes: plan.passes.length, scales: plan.passes.map(pass => pass.scales),
    encodeMs: now() - encodeStarted, encodeBytes: encoded.length, reusedJpeg: encoded === image,
  })
  const deadline = now() + (deps.deadlineMs ?? 100_000)
  let current = encoded
  for (let index = 0; index < plan.passes.length; index += 1) {
    if (now() > deadline) throw new HttpError(504, '扩图超时，请稍后重试', 'OUTPAINT_TIMEOUT')
    current = await submitExpand(config, current, plan.passes[index].scales, {
      fetch: fetchImpl, sleep, now, deadline, requestId: deps.requestId, log, pass: index + 1,
    })
    if (index < plan.passes.length - 1) current = await encodePassInput(current)
  }
  const cropStarted = now()
  const output = await cropOutpaintResult(current, plan)
  log({
    requestId: deps.requestId, stage: 'crop', ms: now() - cropStarted,
    bytes: output.length, targetWidth: plan.targetWidth, targetHeight: plan.targetHeight,
  })
  log({
    requestId: deps.requestId, stage: 'total', ms: now() - started, passes: plan.passes.length, bytes: output.length,
  })
  return output
}
