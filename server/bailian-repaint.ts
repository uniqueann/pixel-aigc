import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { HttpError } from './errors.js'
import { fitDashScopeImageSize } from '../shared/erase.js'
import {
  bailianConfig,
  createDashScopeLog,
  dashScopePayloadError,
  defaultDashScopeFetch,
  encodeJpegForDashScope,
  submitDashScopeImageTask,
  type DashScopeLog,
} from './dashscope.js'
import { PROVIDER_URL_SUBMIT_TIMEOUT_MS, shouldUseProviderUrls, stageProviderInputs } from './provider-input-storage.js'

const PROMPT_LIMIT = 800
export const REPAINT_DEADLINE_MS = 100_000

export function fitRepaintSize(width: number, height: number) {
  const fitted = fitDashScopeImageSize(width, height)
  return { width: fitted.width, height: fitted.height }
}

async function maskIsPainted(mask: Buffer) {
  const { data, info } = await sharp(mask, { failOn: 'none' }).raw().toBuffer({ resolveWithObject: true })
  const channels = info.channels || 1
  for (let index = 0; index < data.length; index += channels) {
    if (data[index] >= 128) return true
  }
  return false
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

interface RepaintDeps {
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  deadlineMs?: number
  deadlineAt?: number
  requestId?: string
  log?: DashScopeLog
}

export async function repaintWithBailian(image: Buffer, mask: Buffer, prompt: string, deps: RepaintDeps = {}) {
  const config = bailianConfig(deps.env ?? process.env)
  if (!config) throw new HttpError(503, '重绘尚未配置阿里云百炼 API Key', 'REPAINT_UNAVAILABLE')
  const text = prompt.trim().slice(0, PROMPT_LIMIT)
  if (!text) throw new HttpError(400, '请先填写重绘描述', 'INVALID_REPAINT')
  const fetchImpl = deps.fetch ?? defaultDashScopeFetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? createDashScopeLog('repaint')
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
  const encoded = await encodeJpegForDashScope(oriented, fitted.width, fitted.height, '图片压缩后仍超过重绘服务的 10 MB 限制')
  const encodedMask = await encodeMask(mask, fitted.width, fitted.height)
  const inputTransport = shouldUseProviderUrls(
    encoded.length + encodedMask.length,
    (deps.env ?? process.env).DASHSCOPE_REPAINT_INPUT_MODE,
  ) ? 'url' : 'inline'
  log({ requestId: deps.requestId, stage: 'plan', inputTransport, encodeBytes: encoded.length,
    maskBytes: encodedMask.length, inputWidth: fitted.width, inputHeight: fitted.height })
  const deadline = Math.min(now() + (deps.deadlineMs ?? REPAINT_DEADLINE_MS), deps.deadlineAt ?? Infinity)
  let baseImageUrl: string
  let maskImageUrl: string
  if (inputTransport === 'url') {
    const uploadStarted = now()
    const signal = deps.deadlineAt ? AbortSignal.timeout(Math.max(1, deadline - now())) : undefined
    const staged = await stageProviderInputs('repaint', deps.requestId ?? randomUUID(), encoded, encodedMask, undefined, signal)
    baseImageUrl = staged.baseImageUrl
    maskImageUrl = staged.maskImageUrl!
    log({ requestId: deps.requestId, stage: 'providerInputUpload', ms: now() - uploadStarted,
      bytes: encoded.length, maskBytes: encodedMask.length })
  } else {
    baseImageUrl = `data:image/jpeg;base64,${encoded.toString('base64')}`
    maskImageUrl = `data:image/png;base64,${encodedMask.toString('base64')}`
  }
  const model = await submitDashScopeImageTask({
    config,
    body: {
      model: 'wanx2.1-imageedit',
      input: {
        function: 'description_edit_with_mask',
        prompt: text,
        base_image_url: baseImageUrl,
        mask_image_url: maskImageUrl,
      },
      parameters: { n: 1, watermark: false },
    },
    fetch: fetchImpl,
    sleep,
    now,
    deadline,
    remainingPasses: 1,
    requestId: deps.requestId,
    log,
    pass: 1,
    extraSubmitLog: { bytes: encoded.length, maskBytes: encodedMask.length, inputTransport },
    submitTimeoutMs: inputTransport === 'url' ? PROVIDER_URL_SUBMIT_TIMEOUT_MS : undefined,
    kind: '重绘',
    errorCode: 'REPAINT_FAILED',
    timeoutCode: 'REPAINT_TIMEOUT',
    timeoutMessage: '重绘超时：任务仍在阿里云处理中，请稍后重试',
    connectMessage: '无法连接到阿里云百炼重绘服务，请稍后重试',
    payloadError: payload => dashScopePayloadError(payload, '重绘', 'REPAINT_FAILED'),
  })
  const compositeStarted = now()
  const output = await compositeRepaint(oriented, model, mask)
  log({ requestId: deps.requestId, stage: 'composite', ms: now() - compositeStarted, bytes: output.length })
  return output
}
