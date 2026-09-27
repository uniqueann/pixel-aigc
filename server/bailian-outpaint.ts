import sharp from 'sharp'
import { HttpError } from './errors.js'
import {
  DEFAULT_EXPAND_PROMPT,
  planBailianOutpaint,
  type PixelPadding,
  type BailianExpandScales,
  type BailianOutpaintPlan,
} from '../shared/outpaint.js'
import {
  DEFAULT_DEADLINE_MS,
  bailianConfig,
  createDashScopeLog,
  dashScopeHost,
  dashScopePollDelay,
  defaultDashScopeFetch,
  encodeJpegForDashScope,
  submitDashScopeImageTask,
  type BailianConfig,
  type BailianPayload,
  type DashScopeLog,
} from './dashscope.js'

export {
  CONNECT_TIMEOUT_MS,
  DEFAULT_DEADLINE_MS,
  FINISH_RESERVE_MS,
  GET_ATTEMPTS,
  MAX_POLLS,
  SUBMIT_ATTEMPTS,
  bailianConfig,
  connectRetryDelay,
  dashScopeHost,
  isTransientConnectError,
  passWaitDeadline,
} from './dashscope.js'

export const outpaintPollDelay = dashScopePollDelay
export const OUTPAINT_WAIT_TIMEOUT_MESSAGE = '扩图超时：任务仍在阿里云处理中，请稍后重试'
export const OUTPAINT_CONNECT_MESSAGE = '无法连接到阿里云百炼扩图服务，请稍后重试'

export type OutpaintLog = DashScopeLog

interface BailianDeps {
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  deadlineMs?: number
  requestId?: string
  log?: OutpaintLog
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

async function encodeInput(image: Buffer, width: number, height: number) {
  return encodeJpegForDashScope(image, width, height, '图片压缩后仍超过扩图服务的 10 MB 限制')
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
    remainingPasses: number
  },
) {
  return submitDashScopeImageTask({
    config,
    body: {
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
    },
    fetch: deps.fetch,
    sleep: deps.sleep,
    now: deps.now,
    deadline: deps.deadline,
    remainingPasses: deps.remainingPasses,
    requestId: deps.requestId,
    log: deps.log,
    pass: deps.pass,
    extraSubmitLog: { bytes: image.length },
    kind: '扩图',
    errorCode: 'OUTPAINT_FAILED',
    timeoutCode: 'OUTPAINT_TIMEOUT',
    timeoutMessage: OUTPAINT_WAIT_TIMEOUT_MESSAGE,
    connectMessage: OUTPAINT_CONNECT_MESSAGE,
    payloadError,
  })
}

export async function expandWithBailian(image: Buffer, padding: PixelPadding, deps: BailianDeps = {}) {
  const config = bailianConfig(deps.env ?? process.env)
  if (!config) throw new HttpError(503, '智能扩展尚未配置阿里云百炼 API Key', 'OUTPAINT_UNAVAILABLE')
  const fetchImpl = deps.fetch ?? defaultDashScopeFetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? createDashScopeLog('outpaint')
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
    host: dashScopeHost(config.baseUrl),
  })
  const deadline = now() + (deps.deadlineMs ?? DEFAULT_DEADLINE_MS)
  let current = encoded
  for (let index = 0; index < plan.passes.length; index += 1) {
    if (now() > deadline) throw new HttpError(504, OUTPAINT_WAIT_TIMEOUT_MESSAGE, 'OUTPAINT_TIMEOUT', { stage: 'wait' })
    current = await submitExpand(config, current, plan.passes[index].scales, {
      fetch: fetchImpl, sleep, now, deadline, requestId: deps.requestId, log, pass: index + 1,
      remainingPasses: plan.passes.length - index,
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
