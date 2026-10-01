import sharp from 'sharp'
import { detectImageMime } from '../shared/image-format.js'
import { HttpError } from './errors.js'

export const BG_REMOVE_MAX_PIXELS = 24_000_000
export const BG_REMOVE_MAX_RESULT_BYTES = 128 * 1024 * 1024
export const TENCENT_MATTING_MAX_BYTES = 9_500_000

interface PrepareOptions {
  deadlineAt?: number
  maxWidth?: number
  maxHeight?: number
  maxBytes?: number
}

export interface PreparedMattingImage {
  originalRgba: Buffer
  width: number
  height: number
  bytes: Buffer
  mimeType: 'image/jpeg' | 'image/png'
  workWidth: number
  workHeight: number
  contentWidth: number
  contentHeight: number
  reusableSource: boolean
}

export function assertMattingDeadline(deadlineAt?: number, stage = 'inputPrepare') {
  if (deadlineAt !== undefined && Date.now() >= deadlineAt) {
    throw new HttpError(504, '抠图处理超时，请重试', 'BG_REMOVE_TIMEOUT', { stage })
  }
}

/** 工作副本只用于识别 Alpha，原图 RGB 始终单独保留。调用前须完成输入校验。 */
export async function prepareMattingImage(image: Buffer, options: PrepareOptions = {}): Promise<PreparedMattingImage> {
  assertMattingDeadline(options.deadlineAt)
  const source = sharp(image, { limitInputPixels: BG_REMOVE_MAX_PIXELS, failOn: 'error' })
  const metadata = await source.metadata()
  const decoded = await source.autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width, height } = decoded.info
  const maxWidth = options.maxWidth ?? 7680
  const maxHeight = options.maxHeight ?? 4320
  const maxBytes = options.maxBytes ?? TENCENT_MATTING_MAX_BYTES
  // 保持 EXIF 校正后的商品朝向；额外旋转可能让识别模型误删商品部件。
  const scale = Math.min(1, maxWidth / width, maxHeight / height)
  let contentWidth = Math.max(1, Math.round(width * scale))
  let contentHeight = Math.max(1, Math.round(height * scale))
  const actualMime = detectImageMime(image)
  const reusableSource = (actualMime === 'image/jpeg' || actualMime === 'image/png') && image.length <= maxBytes
    && !metadata.hasAlpha && (!metadata.orientation || metadata.orientation === 1)
    && scale === 1 && width >= 32 && height >= 32
  if (reusableSource) {
    assertMattingDeadline(options.deadlineAt)
    return { originalRgba: decoded.data, width, height, bytes: image, mimeType: actualMime,
      workWidth: width, workHeight: height, contentWidth: width, contentHeight: height, reusableSource }
  }
  for (;;) {
    const workWidth = Math.max(32, contentWidth)
    const workHeight = Math.max(32, contentHeight)
    for (const quality of [95, 90, 85, 80, 75, 70]) {
      assertMattingDeadline(options.deadlineAt)
      const bytes = await sharp(decoded.data, { raw: { width, height, channels: 4 } })
        .resize(contentWidth, contentHeight, { fit: 'fill' })
        .flatten({ background: '#ffffff' })
        .extend({ top: 0, left: 0, right: workWidth - contentWidth, bottom: workHeight - contentHeight, background: '#ffffff' })
        .jpeg({ quality }).toBuffer()
      assertMattingDeadline(options.deadlineAt)
      if (bytes.length <= maxBytes) return { originalRgba: decoded.data, width, height, bytes, mimeType: 'image/jpeg',
        workWidth, workHeight, contentWidth, contentHeight, reusableSource: false }
    }
    const nextWidth = Math.max(1, Math.floor(contentWidth * 0.85))
    const nextHeight = Math.max(1, Math.floor(contentHeight * 0.85))
    if (nextWidth === contentWidth && nextHeight === contentHeight) {
      throw new HttpError(400, '无法准备符合腾讯要求的图片副本', 'BG_REMOVE_INPUT_INVALID', { stage: 'inputPrepare' })
    }
    contentWidth = nextWidth
    contentHeight = nextHeight
  }
}

/** 只恢复腾讯的透明度，避免将缩小后的商品颜色和纹理放大回原图。 */
export async function restoreMattingImage(png: Buffer, prepared: PreparedMattingImage, deadlineAt?: number): Promise<Buffer> {
  assertMattingDeadline(deadlineAt, 'restoreAlpha')
  if (!png.length || png.length > BG_REMOVE_MAX_RESULT_BYTES || detectImageMime(png) !== 'image/png') {
    throw new HttpError(502, '腾讯没有返回有效的透明 PNG', 'BG_REMOVE_INVALID_RESULT', { stage: 'restoreAlpha' })
  }
  const result = sharp(png, { limitInputPixels: BG_REMOVE_MAX_PIXELS + 7680 * 32, failOn: 'error' })
  const metadata = await result.metadata().catch(() => null)
  if (!metadata?.hasAlpha || (metadata.pages ?? 1) !== 1
    || metadata.width !== prepared.workWidth || metadata.height !== prepared.workHeight) {
    throw new HttpError(502, '腾讯抠图结果格式或尺寸异常', 'BG_REMOVE_INVALID_RESULT', { stage: 'restoreAlpha' })
  }
  let alpha: Buffer
  try {
    // 先单独裁出 Alpha，再恢复尺寸，避免 RGBA 预乘和操作重排影响蒙版。
    const workAlpha = await result.extract({ left: 0, top: 0, width: prepared.contentWidth, height: prepared.contentHeight })
      .extractChannel('alpha').raw().toBuffer()
    alpha = await sharp(workAlpha, { raw: { width: prepared.contentWidth, height: prepared.contentHeight, channels: 1 } })
      .resize(prepared.width, prepared.height, { fit: 'fill', kernel: 'linear' })
      .toColourspace('b-w').raw().toBuffer()
  } catch {
    throw new HttpError(502, '腾讯抠图结果损坏或无法解码', 'BG_REMOVE_INVALID_RESULT', { stage: 'restoreAlpha' })
  }
  assertMattingDeadline(deadlineAt, 'restoreAlpha')
  if (alpha.length !== prepared.width * prepared.height) {
    throw new HttpError(502, '腾讯抠图结果透明度无效', 'BG_REMOVE_INVALID_RESULT', { stage: 'restoreAlpha' })
  }
  const rgba = prepared.originalRgba
  for (let index = 0; index < alpha.length; index += 1) {
    const offset = index * 4 + 3
    rgba[offset] = Math.round(rgba[offset] * alpha[index] / 255)
    // 完全透明处无需保留背景颜色，清零后 PNG 可高效压缩，修边缘仍从原文件恢复。
    if (rgba[offset] === 0) { rgba[offset - 3] = 0; rgba[offset - 2] = 0; rgba[offset - 1] = 0 }
  }
  const output = await sharp(rgba, { raw: { width: prepared.width, height: prepared.height, channels: 4 } })
    .png({ compressionLevel: 6 }).toBuffer()
  assertMattingDeadline(deadlineAt, 'restoreAlpha')
  if (output.length > BG_REMOVE_MAX_RESULT_BYTES) {
    throw new HttpError(502, '抠图结果过大，请使用较小的原图', 'BG_REMOVE_RESULT_TOO_LARGE', { stage: 'restoreAlpha' })
  }
  return output
}
