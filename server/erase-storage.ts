import sharp, { type Metadata } from 'sharp'
import { HttpError } from './errors.js'
import { isSafeObjectKey } from './image-jobs/service.js'
import { getObjectLimited } from './storage.js'
import { detectImageMime, type ImageMime } from '../shared/image-format.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000

export interface StoredSyncImage {
  bytes: Buffer
  width: number
  height: number
  mimeType: ImageMime
}

export interface StoredImageOptions {
  maxPixels?: number
  onRead?: (bytes: number, elapsedMs: number) => void
  onValidate?: (entry: Record<string, unknown>) => void
}

/** 原图依据真实字节兼容旧 MIME 标记；蒙版保持严格 PNG 校验。 */
export async function validateSyncImage(
  bytes: Buffer, kind: 'source' | 'mask', declaredMime?: string, maxPixels = MAX_IMAGE_PIXELS,
): Promise<Omit<StoredSyncImage, 'bytes'>> {
  const code = kind === 'mask' ? 'INVALID_MASK' : 'INVALID_IMAGE'
  const mimeType = detectImageMime(bytes)
  if (!mimeType || (kind === 'mask' && (mimeType !== 'image/png' || declaredMime !== 'image/png'))) {
    throw new HttpError(400, kind === 'mask' ? '蒙版实际格式或尺寸无效，必须使用 PNG' : '图片格式不支持，仅支持静态 PNG、JPEG 和 WebP', code, { stage: 'imageValidate' })
  }
  let metadata: Metadata
  try {
    metadata = await sharp(bytes, { limitInputPixels: maxPixels, failOn: 'error' }).metadata()
  } catch (error) {
    const exceeded = error instanceof Error && /pixel limit/i.test(error.message)
    throw new HttpError(400, exceeded ? `图片像素不能超过 ${maxPixels / 1_000_000} 百万像素` : '图片文件损坏或无法解码', code, { stage: 'imageValidate' })
  }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  if (!width || !height || width * height > maxPixels || (metadata.pages ?? 1) !== 1) {
    throw new HttpError(400, width * height > maxPixels ? `图片像素不能超过 ${maxPixels / 1_000_000} 百万像素` : '图片尺寸无效或不是静态图片', code, { stage: 'imageValidate' })
  }
  // 缩为单像素触发完整解码，不保留整张原图的像素缓冲区。
  try { await sharp(bytes, { limitInputPixels: maxPixels, failOn: 'error' }).resize(1, 1).raw().toBuffer() }
  catch { throw new HttpError(400, '图片文件损坏或无法解码', code, { stage: 'imageValidate' }) }
  return { width, height, mimeType }
}

export async function loadStoredSyncImage(
  userId: string, key: string, kind: 'source' | 'mask', signal?: AbortSignal, options: StoredImageOptions = {},
): Promise<StoredSyncImage> {
  if (!isSafeObjectKey(userId, key) || (kind === 'mask' && !key.startsWith(`temporary/task-inputs/${userId}/`))) {
    throw new HttpError(400, '图片对象无效或无权访问', 'INVALID_SOURCE')
  }
  const readStarted = Date.now()
  let object: Awaited<ReturnType<typeof getObjectLimited>>
  try {
    object = signal ? await getObjectLimited(key, MAX_IMAGE_BYTES, signal) : await getObjectLimited(key, MAX_IMAGE_BYTES)
  } catch (error) {
    options.onRead?.(0, Date.now() - readStarted)
    if (signal?.aborted) throw new HttpError(504, '读取临时图片超时，请重试', 'IMAGE_READ_TIMEOUT', { cause: error, stage: 'objectRead' })
    throw error
  }
  options.onRead?.(object.bytes.length, Date.now() - readStarted)
  const validateStarted = Date.now()
  let size: Awaited<ReturnType<typeof validateSyncImage>> | undefined
  try {
    size = await validateSyncImage(object.bytes, kind, object.contentType, options.maxPixels)
    return { bytes: object.bytes, ...size }
  } finally {
    options.onValidate?.({ stage: 'imageValidate', ms: Date.now() - validateStarted,
      declaredMime: object.contentType ?? null, actualMime: detectImageMime(object.bytes) ?? null,
      width: size?.width, height: size?.height, valid: !!size })
  }
}

export const loadEraseStoredImage = loadStoredSyncImage
