import sharp from 'sharp'
import { HttpError } from '../errors.js'

/** DragonCode 4K 16:9 实测 3840x2161（不是 2160）。对数比例差约 4.6e-4，0.01 足够吞掉 off-by-one。 */
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
  exactSize?: { width: number; height: number },
): Promise<{
  bytes: Uint8Array
  width: number
  height: number
  mimeType: string
  cropped: boolean
  /** 是否发生过 resize；测试 stub 可省略。 */
  resized?: boolean
}> {
  try {
    const image = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 })
    const meta = await image.metadata()
    if (!meta.width || !meta.height) throw new HttpError(502, '结果图片无法解析尺寸', 'BAD_RESULT')
    const targetRatio = Math.max(1, sourceWidth) / Math.max(1, sourceHeight)
    const rect = cropRect(meta.width, meta.height, targetRatio)
    const format = meta.format === 'jpeg' || meta.format === 'webp' ? meta.format : 'png'
    const targetWidth = exactSize ? Math.max(1, Math.round(exactSize.width)) : rect.width
    const targetHeight = exactSize ? Math.max(1, Math.round(exactSize.height)) : rect.height
    const resized = Boolean(exactSize && (rect.width !== targetWidth || rect.height !== targetHeight))
    let output: Buffer
    if (rect.cropped || resized) {
      // 裁切保证比例，resize 用 fill 精确落到原图像素；两者共用一次解码与编码。
      let pipeline = sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 })
      if (rect.cropped) pipeline = pipeline.extract(rect)
      if (resized) pipeline = pipeline.resize(targetWidth, targetHeight, { fit: 'fill' })
      output = await pipeline[format]().toBuffer()
    } else {
      await sharp(bytes, { failOn: 'warning', limitInputPixels: 40_000_000 }).raw().toBuffer()
      output = Buffer.from(bytes)
    }
    return {
      bytes: new Uint8Array(output),
      width: resized ? targetWidth : rect.width,
      height: resized ? targetHeight : rect.height,
      mimeType: mimeFromFormat(format),
      cropped: rect.cropped,
      resized,
    }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, '结果图片损坏或无法解码', 'BAD_RESULT')
  }
}
