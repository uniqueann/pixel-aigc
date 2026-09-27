import sharp from 'sharp'
import { Agent, fetch as undiciFetch } from 'undici'
import {
  CONNECT_TIMEOUT_MS,
  GET_ATTEMPTS,
  MAX_POLLS,
  SUBMIT_ATTEMPTS,
  bailianConfig,
  connectRetryDelay,
  dashScopeHost,
  isTransientConnectError,
  outpaintPollDelay,
  type BailianConfig,
  type OutpaintLog,
} from './bailian-outpaint.js'
import { describeError, HttpError } from './errors.js'

const MIN_EDGE = 512
const MAX_EDGE = 4096
const PROMPT_LIMIT = 800
const SYNTHESIS_PATH = '/api/v1/services/aigc/image2image/image-synthesis'
const WAIT_TIMEOUT_MESSAGE = '重绘超时：任务仍在阿里云处理中，请稍后重试'

const dashScopeDispatcher = new Agent({
  connectTimeout: CONNECT_TIMEOUT_MS,
  headersTimeout: 20_000,
  bodyTimeout: 30_000,
})

interface RepaintDeps {
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

export function fitRepaintSize(width: number, height: number) {
  const minSide = Math.min(width, height)
  const maxSide = Math.max(width, height)
  let scale = 1
  if (minSide < MIN_EDGE) scale = MIN_EDGE / minSide
  if (maxSide * scale > MAX_EDGE) scale = MAX_EDGE / maxSide
  let fittedWidth = Math.round(width * scale)
  let fittedHeight = Math.round(height * scale)
  if (fittedWidth > MAX_EDGE || fittedHeight > MAX_EDGE) {
    const down = MAX_EDGE / Math.max(fittedWidth, fittedHeight)
    fittedWidth = Math.round(fittedWidth * down)
    fittedHeight = Math.round(fittedHeight * down)
  }
  if (fittedWidth < MIN_EDGE || fittedHeight < MIN_EDGE || fittedWidth > MAX_EDGE || fittedHeight > MAX_EDGE) {
    throw new Error('原图宽高比超出重绘服务可接受的范围')
  }
  return { width: fittedWidth, height: fittedHeight }
}

function defaultFetch(input: Parameters<typeof fetch>[0], init?: RequestInit) {
  return undiciFetch(
    input as Parameters<typeof undiciFetch>[0],
    { ...(init as object), dispatcher: dashScopeDispatcher } as Parameters<typeof undiciFetch>[1],
  ) as unknown as Promise<Response>
}

function failureText(code: string, message: string) {
  const detail = message.replace(/\s+/g, ' ').trim().slice(0, 180)
  const combined = `${code} ${message}`
  if (code === 'InvalidApiKey' || /invalid api-?key|no api-key/i.test(combined)) return '阿里云百炼 API Key 无效'
  if (code === 'Arrearage' || /欠费|arrearage|overdue/i.test(combined)) return '阿里云百炼账户已欠费，请充值后再试'
  if (code === 'InvalidParameter.FileDownload') return '重绘服务无法读取这张图片'
  if (code === 'InvalidParameter.ImageFormat') return '这张图片的格式不受重绘服务支持'
  if (code === 'DataInspectionFailed' || code === 'InvalidParameter.ImageContent' || code === 'InvalidParameter.DataInspection') {
    return '这张图片没有通过内容审核'
  }
  if (code === 'IPInfringementSuspect') return '这张图片可能涉及侵权，无法重绘'
  if (code === 'InvalidParameter') return detail ? `重绘参数超出服务限制：${detail}` : '重绘参数超出服务限制'
  if (code.startsWith('InternalError')) return '重绘服务暂时不可用，请稍后重试'
  return detail ? `重绘失败：${detail}` : '重绘失败'
}

function payloadError(payload: BailianPayload) {
  const result = payload.output?.results?.find(item => item.code || item.message)
  const code = payload.code || payload.output?.code || result?.code || ''
  const message = payload.message || payload.output?.message || result?.message || ''
  if (!code && !message) return null
  return new HttpError(502, failureText(code, message), 'REPAINT_FAILED')
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
      log({ stage, attempt, attempts, retry, error: details.message, ms: now() - started, ...rest })
      if (!retry) throw new HttpError(502, '无法连接到阿里云百炼重绘服务，请稍后重试', 'REPAINT_FAILED', { cause: error, stage })
      await sleep(connectRetryDelay(attempt - 1))
    }
  }
  throw new HttpError(502, '无法连接到阿里云百炼重绘服务，请稍后重试', 'REPAINT_FAILED', { cause: lastError, stage })
}

function resultImageUrl(payload: BailianPayload) {
  return payload.output?.results?.find(item => item.url)?.url || payload.output?.output_image_url || ''
}

async function maskIsPainted(mask: Buffer) {
  const { data, info } = await sharp(mask, { failOn: 'none' }).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels || 1
  for (let index = 0; index < data.length; index += channels) {
    if (data[index] >= 128) return true
  }
  return false
}

async function encodeJpeg(image: Buffer, width: number, height: number) {
  let quality = 90
  let encoded = await sharp(image, { failOn: 'none' }).resize(width, height, { fit: 'fill' }).jpeg({ quality }).toBuffer()
  while (encoded.length > 9_000_000 && quality > 60) {
    quality -= 10
    encoded = await sharp(image, { failOn: 'none' }).resize(width, height, { fit: 'fill' }).jpeg({ quality }).toBuffer()
  }
  if (encoded.length > 10_000_000) throw new HttpError(413, '图片压缩后仍超过重绘服务的 10 MB 限制')
  return encoded
}

async function encodeMask(mask: Buffer, width: number, height: number) {
  return sharp(mask, { failOn: 'none' })
    .resize(width, height, { kernel: 'nearest', fit: 'fill' })
    .threshold(128)
    .png()
    .toBuffer()
}

/** 白区用模型像素，黑区保持原图像素，输出与原图同尺寸。 */
export async function compositeRepaint(original: Buffer, model: Buffer, mask: Buffer) {
  const meta = await sharp(original, { failOn: 'none' }).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  const base = await sharp(original, { failOn: 'none' }).ensureAlpha().raw().toBuffer()
  const painted = await sharp(model, { failOn: 'none' }).rotate().resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer()
  const { data: marks, info } = await sharp(mask, { failOn: 'none' })
    .resize(width, height, { kernel: 'nearest', fit: 'fill' })
    .threshold(128)
    .raw()
    .toBuffer({ resolveWithObject: true })
  const channels = info.channels || 1
  for (let index = 0; index < width * height; index += 1) {
    if (marks[index * channels] < 128) continue
    const offset = index * 4
    base[offset] = painted[offset]
    base[offset + 1] = painted[offset + 1]
    base[offset + 2] = painted[offset + 2]
    base[offset + 3] = 255
  }
  return sharp(base, { raw: { width, height, channels: 4 } }).jpeg({ quality: 92 }).toBuffer()
}

async function submitRepaint(
  config: BailianConfig,
  image: Buffer,
  mask: Buffer,
  prompt: string,
  deps: {
    fetch: typeof fetch
    sleep: (ms: number) => Promise<void>
    now: () => number
    deadline: number
    requestId?: string
    log: OutpaintLog
  },
) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  }
  const created = await callDashScope(deps.fetch, `${config.baseUrl}${SYNTHESIS_PATH}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'wanx2.1-imageedit',
      input: {
        function: 'description_edit_with_mask',
        prompt,
        base_image_url: `data:image/jpeg;base64,${image.toString('base64')}`,
        mask_image_url: `data:image/png;base64,${mask.toString('base64')}`,
      },
      parameters: { n: 1, watermark: false },
    }),
  }, 'submit', SUBMIT_ATTEMPTS, 20_000, deps.sleep, deps.log, {
    requestId: deps.requestId, host: dashScopeHost(config.baseUrl), now: deps.now,
  })
  const createdPayload = await readJson(created)
  if (!created.ok) throw payloadError(createdPayload) ?? new HttpError(502, '重绘任务提交失败', 'REPAINT_FAILED')
  const failed = payloadError(createdPayload)
  if (failed && !createdPayload.output?.task_id) throw failed
  const taskId = createdPayload.output?.task_id
  if (!taskId) throw new HttpError(502, '重绘服务没有返回任务编号', 'REPAINT_FAILED')

  const waitDeadline = deps.deadline
  let imageUrl = ''
  let polls = 0
  while (polls < MAX_POLLS) {
    const delay = outpaintPollDelay(polls)
    if (deps.now() + delay > waitDeadline) break
    await deps.sleep(delay)
    if (deps.now() > waitDeadline) break
    const polled = await callDashScope(deps.fetch, `${config.baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
    }, 'poll', GET_ATTEMPTS, 20_000, deps.sleep, deps.log, { requestId: deps.requestId, poll: polls, now: deps.now })
    const payload = await readJson(polled)
    const status = payload.output?.task_status
    polls += 1
    if (!polled.ok) throw payloadError(payload) ?? new HttpError(502, '重绘结果查询失败', 'REPAINT_FAILED')
    if (status === 'SUCCEEDED') {
      imageUrl = resultImageUrl(payload)
      if (!imageUrl) throw payloadError(payload) ?? new HttpError(502, '重绘没有返回图片', 'REPAINT_FAILED')
      break
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw payloadError(payload) ?? new HttpError(502, '重绘失败', 'REPAINT_FAILED')
    }
  }
  if (!imageUrl) throw new HttpError(504, WAIT_TIMEOUT_MESSAGE, 'REPAINT_TIMEOUT', { stage: 'wait' })
  const downloaded = await callDashScope(deps.fetch, imageUrl, undefined, 'download', GET_ATTEMPTS, 30_000, deps.sleep, deps.log, {
    requestId: deps.requestId, now: deps.now,
  })
  if (!downloaded.ok) throw new HttpError(502, '重绘结果下载失败', 'REPAINT_FAILED')
  return Buffer.from(await downloaded.arrayBuffer())
}

export async function repaintWithBailian(image: Buffer, mask: Buffer, prompt: string, deps: RepaintDeps = {}) {
  const config = bailianConfig(deps.env ?? process.env)
  if (!config) throw new HttpError(503, '重绘尚未配置阿里云百炼 API Key', 'REPAINT_UNAVAILABLE')
  const text = prompt.trim().slice(0, PROMPT_LIMIT)
  if (!text) throw new HttpError(400, '请先填写重绘描述', 'INVALID_REPAINT')
  const fetchImpl = deps.fetch ?? defaultFetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? (() => {})
  let oriented: Buffer
  try {
    oriented = await sharp(image, { failOn: 'none' }).rotate().toBuffer()
  } catch {
    throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  }
  const meta = await sharp(oriented, { failOn: 'none' }).metadata()
  if (!meta.width || !meta.height) throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  const maskMeta = await sharp(mask, { failOn: 'none' }).metadata()
  if (maskMeta.width !== meta.width || maskMeta.height !== meta.height) {
    throw new HttpError(400, '蒙版尺寸与原图不一致', 'INVALID_REPAINT')
  }
  if (!(await maskIsPainted(mask))) throw new HttpError(400, '请先涂抹要重绘的区域', 'INVALID_REPAINT')
  let fitted: { width: number; height: number }
  try {
    fitted = fitRepaintSize(meta.width, meta.height)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : '重绘参数无效', 'INVALID_REPAINT')
  }
  const encoded = await encodeJpeg(oriented, fitted.width, fitted.height)
  const encodedMask = await encodeMask(mask, fitted.width, fitted.height)
  const deadline = now() + (deps.deadlineMs ?? 90_000)
  const model = await submitRepaint(config, encoded, encodedMask, text, {
    fetch: fetchImpl, sleep, now, deadline, requestId: deps.requestId, log,
  })
  return compositeRepaint(oriented, model, mask)
}
