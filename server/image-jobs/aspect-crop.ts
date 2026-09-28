import sharp from 'sharp'
import { HttpError } from '../errors.js'

const RATIO_EPSILON = 0.01

export function cropRect(width: number, height: number, targetRatio: number) {
  const current = width / height
  if (!Number.isFinite(targetRatio) || targetRatio <= 0 || Math.abs(Math.log(current) - Math.log(targetRatio)) < RATIO_EPSILON) {
    return { left: 0, top: 0, width, height, cropped: false }
  }
  if (current > targetRatio) {
    const nextWidth = Math.max(1, Math.round(height * targetRatio))
    return { left: Math.floor((width - nextWidth) / 2), top: 0, width: nextWidth, height, cropped: true }
  }
  const nextHeight = Math.max(1, Math.round(width / targetRatio))
  return { left: 0, top: Math.floor((height - nextHeight) / 2), width, height: nextHeight, cropped: true }
}

export function mimeFromFormat(format?: string) {
  if (format === 'jpeg' || format === 'jpg') return 'image/jpeg'
  if (format === 'webp') return 'image/webp'
  return 'image/png'
}

export async function cropToSourceAspect(
  bytes: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
) {
  const image = sharp(bytes, { failOn: 'none', limitInputPixels: 40_000_000 })
  const meta = await image.metadata()
  if (!meta.width || !meta.height) throw new HttpError(502, '结果图片无法解析尺寸', 'BAD_RESULT')
  const targetRatio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight)
  const rect = cropRect(meta.width, meta.height, targetRatio)
  const format = meta.format === 'jpeg' || meta.format === 'webp' ? meta.format : 'png'
  const output = rect.cropped
    ? await sharp(bytes, { failOn: 'none', limitInputPixels: 40_000_000 }).extract(rect)[format]().toBuffer()
    : Buffer.from(bytes)
  return {
    bytes: new Uint8Array(output),
    width: rect.width,
    height: rect.height,
    mimeType: mimeFromFormat(format),
    cropped: rect.cropped,
  }
}
