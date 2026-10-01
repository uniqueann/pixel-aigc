import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { HttpError } from './errors.js'
import {
  PROVIDER_URL_EXPIRES_SECONDS, PROVIDER_URL_SUBMIT_TIMEOUT_MS, PROVIDER_URL_THRESHOLD_BYTES,
  shouldUseProviderUrls, stageProviderInputs,
} from './provider-input-storage.js'
import {
  MASK_DILATE_RADIUS,
  MASK_WHITE_THRESHOLD,
  dilateMask,
  fitDashScopeImageSize,
  maskHasEraseRegion,
  normalizeErasePrompt,
  scaleMaskNearest,
  thresholdMask,
  trimErasePrompt,
} from '../shared/erase.js'
import {
  bailianConfig,
  createDashScopeLog,
  dashScopeHost,
  dashScopePayloadError,
  defaultDashScopeFetch,
  encodeJpegForDashScope,
  submitDashScopeImageTask,
  type DashScopeLog,
} from './dashscope.js'

export const ERASE_WAIT_TIMEOUT_MESSAGE = '消除超时：任务仍在阿里云处理中，请稍后重试'
export const ERASE_CONNECT_MESSAGE = '无法连接到阿里云百炼消除服务，请稍后重试'
export const ERASE_MASK_DATA_URL_PREFIX = 'data:image/png;base64,'
export const ERASE_PROVIDER_URL_THRESHOLD_BYTES = PROVIDER_URL_THRESHOLD_BYTES
export const ERASE_PROVIDER_URL_EXPIRES_SECONDS = PROVIDER_URL_EXPIRES_SECONDS
export const ERASE_SUBMIT_TIMEOUT_MS = PROVIDER_URL_SUBMIT_TIMEOUT_MS
export const ERASE_DEADLINE_MS = 100_000

export function eraseMaskDataUrl(png: Buffer) {
  return `${ERASE_MASK_DATA_URL_PREFIX}${png.toString('base64')}`
}

export function shouldUseEraseProviderUrls(imageBytes: number, maskBytes: number, mode?: string) {
  return shouldUseProviderUrls(imageBytes + maskBytes, mode)
}

export type EraseLog = DashScopeLog

interface EraseDeps {
  fetch?: typeof fetch
  env?: NodeJS.ProcessEnv
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  deadlineMs?: number
  requestId?: string
  log?: EraseLog
  dilateRadius?: number
}

export interface PreparedEraseMask {
  png: Buffer
  width: number
  height: number
  sourceWidth: number
  sourceHeight: number
}

function channelsOf(channels: number): 1 | 3 | 4 {
  if (channels === 1 || channels === 3 || channels === 4) return channels
  return 4
}

/** 解码蒙版 → 对齐到指定宽高 → 二值化 → 膨胀。 */
export async function prepareEraseMask(
  mask: Buffer,
  targetWidth: number,
  targetHeight: number,
  dilateRadius = MASK_DILATE_RADIUS,
): Promise<PreparedEraseMask> {
  let raw: { data: Buffer; info: { width: number; height: number; channels: number } }
  try {
    raw = await sharp(mask, { failOn: 'none' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  } catch {
    throw new HttpError(400, '无法读取消除蒙版', 'INVALID_MASK')
  }
  const sourceWidth = raw.info.width
  const sourceHeight = raw.info.height
  if (!sourceWidth || !sourceHeight) throw new HttpError(400, '无法读取消除蒙版', 'INVALID_MASK')
  let binary = thresholdMask(raw.data, sourceWidth, sourceHeight, channelsOf(raw.info.channels), MASK_WHITE_THRESHOLD)
  if (sourceWidth !== targetWidth || sourceHeight !== targetHeight) {
    binary = scaleMaskNearest(binary, sourceWidth, sourceHeight, targetWidth, targetHeight)
  }
  binary = dilateMask(binary, targetWidth, targetHeight, dilateRadius)
  if (!maskHasEraseRegion(binary)) throw new HttpError(400, '请先涂抹要消除的区域', 'EMPTY_MASK')
  const png = await sharp(Buffer.from(binary), {
    raw: { width: targetWidth, height: targetHeight, channels: 1 },
  }).toColourspace('b-w').png().toBuffer()
  return { png, width: targetWidth, height: targetHeight, sourceWidth, sourceHeight }
}

export async function restoreEraseResult(modelImage: Buffer, targetWidth: number, targetHeight: number) {
  const meta = await sharp(modelImage, { failOn: 'none' }).metadata()
  const modelWidth = meta.width ?? 0
  const modelHeight = meta.height ?? 0
  if (!modelWidth || !modelHeight) throw new HttpError(502, '消除结果无法读取', 'ERASE_FAILED')
  if (modelWidth === targetWidth && modelHeight === targetHeight && meta.format === 'jpeg') {
    return { output: modelImage, modelWidth, modelHeight, resized: false }
  }
  const output = await sharp(modelImage, { failOn: 'none' })
    .resize(targetWidth, targetHeight, { fit: 'fill' })
    .jpeg({ quality: 92 })
    .toBuffer()
  return {
    output,
    modelWidth,
    modelHeight,
    resized: modelWidth !== targetWidth || modelHeight !== targetHeight,
  }
}

export async function eraseWithBailian(image: Buffer, mask: Buffer, prompt: string, deps: EraseDeps = {}) {
  const config = bailianConfig(deps.env ?? process.env)
  if (!config) throw new HttpError(503, '图片消除尚未配置阿里云百炼 API Key', 'ERASE_UNAVAILABLE')
  const fetchImpl = deps.fetch ?? defaultDashScopeFetch
  const sleep = deps.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const now = deps.now ?? Date.now
  const log = deps.log ?? createDashScopeLog('erase')
  const started = now()
  let size: { width?: number; height?: number }
  try {
    size = await sharp(image, { failOn: 'none' }).rotate().metadata()
  } catch {
    throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  }
  if (!size.width || !size.height) throw new HttpError(400, '无法读取图片', 'INVALID_IMAGE')
  let fitted: { width: number; height: number }
  try {
    fitted = fitDashScopeImageSize(size.width, size.height)
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : '消除参数无效', 'INVALID_ERASE')
  }
  const encodeStarted = now()
  const encoded = await encodeJpegForDashScope(image, fitted.width, fitted.height, '图片压缩后仍超过消除服务的 10 MB 限制')
  const prepared = await prepareEraseMask(mask, fitted.width, fitted.height, deps.dilateRadius ?? MASK_DILATE_RADIUS)
  const normalizedPrompt = normalizeErasePrompt(prompt)
  const inputTransport = shouldUseEraseProviderUrls(encoded.length, prepared.png.length, (deps.env ?? process.env).DASHSCOPE_ERASE_INPUT_MODE)
    ? 'url' : 'inline'
  log({
    requestId: deps.requestId, stage: 'plan',
    sourceWidth: size.width, sourceHeight: size.height,
    inputWidth: fitted.width, inputHeight: fitted.height,
    maskSourceWidth: prepared.sourceWidth, maskSourceHeight: prepared.sourceHeight,
    maskWidth: prepared.width, maskHeight: prepared.height,
    promptChars: normalizedPrompt.length,
    promptDefaulted: !trimErasePrompt(prompt),
    encodeMs: now() - encodeStarted, encodeBytes: encoded.length, reusedJpeg: encoded === image,
    inputTransport,
    host: dashScopeHost(config.baseUrl),
  })
  let baseImageUrl: string
  let maskImageUrl: string
  if (inputTransport === 'url') {
    const uploadStarted = now()
    const staged = await stageProviderInputs('erase', deps.requestId ?? randomUUID(), encoded, prepared.png)
    baseImageUrl = staged.baseImageUrl
    maskImageUrl = staged.maskImageUrl!
    log({ requestId: deps.requestId, stage: 'providerInputUpload', ms: now() - uploadStarted,
      bytes: encoded.length, maskBytes: prepared.png.length })
  } else {
    baseImageUrl = `data:image/jpeg;base64,${encoded.toString('base64')}`
    maskImageUrl = eraseMaskDataUrl(prepared.png)
  }
  const deadline = now() + (deps.deadlineMs ?? ERASE_DEADLINE_MS)
  const modelImage = await submitDashScopeImageTask({
    config,
    body: {
      model: 'wanx2.1-imageedit',
      input: {
        function: 'description_edit_with_mask',
        prompt: normalizedPrompt,
        base_image_url: baseImageUrl,
        mask_image_url: maskImageUrl,
      },
      parameters: {
        n: 1,
        watermark: false,
      },
    },
    fetch: fetchImpl,
    sleep,
    now,
    deadline,
    remainingPasses: 1,
    requestId: deps.requestId,
    log,
    pass: 1,
    extraSubmitLog: { bytes: encoded.length, maskBytes: prepared.png.length },
    submitTimeoutMs: inputTransport === 'url' ? ERASE_SUBMIT_TIMEOUT_MS : undefined,
    kind: '消除',
    errorCode: 'ERASE_FAILED',
    timeoutCode: 'ERASE_TIMEOUT',
    timeoutMessage: ERASE_WAIT_TIMEOUT_MESSAGE,
    connectMessage: ERASE_CONNECT_MESSAGE,
    payloadError: payload => dashScopePayloadError(payload, '消除', 'ERASE_FAILED'),
  })
  const restoreStarted = now()
  const restored = await restoreEraseResult(modelImage, size.width, size.height)
  log({
    requestId: deps.requestId, stage: 'restore', ms: now() - restoreStarted,
    inputWidth: size.width, inputHeight: size.height,
    modelWidth: restored.modelWidth, modelHeight: restored.modelHeight,
    outputWidth: size.width, outputHeight: size.height,
    resized: restored.resized, bytes: restored.output.length,
  })
  log({
    requestId: deps.requestId, stage: 'total', ms: now() - started, bytes: restored.output.length,
  })
  return restored.output
}
