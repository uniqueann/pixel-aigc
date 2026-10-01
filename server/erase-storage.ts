import sharp from 'sharp'
import { HttpError } from './errors.js'
import { isSafeObjectKey } from './image-jobs/service.js'
import { getObjectLimited } from './storage.js'

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_IMAGE_PIXELS = 40_000_000
const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export interface StoredSyncImage {
  bytes: Buffer
  width: number
  height: number
}

export async function loadStoredSyncImage(userId: string, key: string, kind: 'source' | 'mask', signal?: AbortSignal): Promise<StoredSyncImage> {
  if (!isSafeObjectKey(userId, key) || (kind === 'mask' && !key.startsWith(`temporary/task-inputs/${userId}/`))) {
    throw new HttpError(400, '图片对象无效或无权访问', 'INVALID_SOURCE')
  }
  let object: Awaited<ReturnType<typeof getObjectLimited>>
  try {
    object = signal ? await getObjectLimited(key, MAX_IMAGE_BYTES, signal) : await getObjectLimited(key, MAX_IMAGE_BYTES)
  } catch (error) {
    if (signal?.aborted) throw new HttpError(504, '读取临时图片超时，请重试', 'IMAGE_READ_TIMEOUT', { cause: error, stage: 'objectRead' })
    throw error
  }
  let metadata: { width?: number; height?: number; pages?: number; format?: string }
  try {
    metadata = await sharp(object.bytes, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' }).metadata()
  } catch {
    throw new HttpError(400, '图片文件无效', 'INVALID_IMAGE')
  }
  const width = metadata.width ?? 0
  const height = metadata.height ?? 0
  const actualMime = MIME_BY_FORMAT[metadata.format ?? '']
  if (!width || !height || width * height > MAX_IMAGE_PIXELS || (metadata.pages ?? 1) !== 1
    || !actualMime || actualMime !== object.contentType || (kind === 'mask' && actualMime !== 'image/png')) {
    throw new HttpError(400, '图片实际格式或尺寸无效', kind === 'mask' ? 'INVALID_MASK' : 'INVALID_IMAGE')
  }
  return { bytes: object.bytes, width, height }
}

export const loadEraseStoredImage = loadStoredSyncImage
