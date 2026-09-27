import sharp from 'sharp'
import { HttpError } from './errors.js'
import {
  DEFAULT_EXPAND_PROMPT,
  planBailianOutpaint,
  type PixelPadding,
  type BailianExpandScales,
  type BailianOutpaintPlan,
} from '../shared/outpaint.js'

export interface BailianConfig {
  apiKey: string
  baseUrl: string
}

interface BailianDeps {
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  deadlineMs?: number
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

function resultImageUrl(payload: BailianPayload) {
  return payload.output?.results?.find(item => item.url)?.url || payload.output?.output_image_url || ''
}

async function encodeInput(image: Buffer, width: number, height: number) {
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
  deps: { fetch: typeof fetch; sleep: (ms: number) => Promise<void>; now: () => number; deadline: number },
) {
  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'X-DashScope-Async': 'enable',
  }
  const created = await deps.fetch(`${config.baseUrl}${SYNTHESIS_PATH}`, {
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
    signal: AbortSignal.timeout(20_000),
  })
  const createdPayload = await readJson(created)
  if (!created.ok) throw payloadError(createdPayload) ?? new HttpError(502, '扩图任务提交失败', 'OUTPAINT_FAILED')
  const failed = payloadError(createdPayload)
  if (failed && !createdPayload.output?.task_id) throw failed
  const taskId = createdPayload.output?.task_id
  if (!taskId) throw new HttpError(502, '扩图服务没有返回任务编号', 'OUTPAINT_FAILED')

  let imageUrl = ''
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (deps.now() > deps.deadline) break
    await deps.sleep(attempt === 0 ? 1000 : 1500)
    const polled = await deps.fetch(`${config.baseUrl}/api/v1/tasks/${taskId}`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(20_000),
    })
    const payload = await readJson(polled)
    if (!polled.ok) throw payloadError(payload) ?? new HttpError(502, '扩图结果查询失败', 'OUTPAINT_FAILED')
    const status = payload.output?.task_status
    if (status === 'SUCCEEDED') {
      imageUrl = resultImageUrl(payload)
      if (!imageUrl) throw payloadError(payload) ?? new HttpError(502, '扩图没有返回图片', 'OUTPAINT_FAILED')
      break
    }
    if (status === 'FAILED' || status === 'CANCELED' || status === 'UNKNOWN') {
      throw payloadError(payload) ?? new HttpError(502, '扩图失败', 'OUTPAINT_FAILED')
    }
  }
  if (!imageUrl) throw new HttpError(504, '扩图超时，请稍后重试', 'OUTPAINT_TIMEOUT')
  const downloaded = await deps.fetch(imageUrl, { signal: AbortSignal.timeout(30_000) })
  if (!downloaded.ok) throw new HttpError(502, '扩图结果下载失败', 'OUTPAINT_FAILED')
  return Buffer.from(await downloaded.arrayBuffer())
}

export async function expandWithBailian(image: Buffer, padding: PixelPadding, deps: BailianDeps = {}) {
  const config = bailianConfig(deps.env ?? process.env)
  if (!config) throw new HttpError(503, '智能扩展尚未配置阿里云百炼 API Key', 'OUTPAINT_UNAVAILABLE')
  const fetchImpl = deps.fetch ?? fetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
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
  const deadline = now() + (deps.deadlineMs ?? 80_000)
  let current = await encodeInput(image, plan.inputWidth, plan.inputHeight)
  for (const pass of plan.passes) {
    if (now() > deadline) throw new HttpError(504, '扩图超时，请稍后重试', 'OUTPAINT_TIMEOUT')
    current = await submitExpand(config, current, pass.scales, { fetch: fetchImpl, sleep, now, deadline })
    if (plan.passes.length > 1) current = await encodePassInput(current)
  }
  return cropOutpaintResult(current, plan)
}
