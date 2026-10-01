import { normalizeImageBlob } from '@shared/image-format'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import type { ImageAsset } from '@/editor/types'
import { fetchOwnedObject } from '@/services/api/objects'

const MIME_EXTENSION: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

export function extensionForMime(mimeType?: string) {
  if (!mimeType) return 'jpg'
  return MIME_EXTENSION[mimeType] ?? (mimeType.startsWith('image/') ? mimeType.slice(6) : 'jpg')
}

/** 保留原名，按实际字节 MIME 换扩展名（mug.jpg + PNG → mug.png）。 */
export function filenameWithMimeExtension(name: string, mimeType?: string) {
  const trimmed = name.trim() || '图片'
  const base = trimmed.replace(/\.[^.]+$/, '') || trimmed
  return `${base}.${extensionForMime(mimeType)}`
}

export function filenameForWorkstationResult(input: {
  toolLabel: string
  width: number
  height: number
  mimeType?: string
  index?: number
}) {
  const safeLabel = input.toolLabel.replace(/[\\/:*?"<>|]+/g, '').trim() || '结果'
  const suffix = input.index && input.index > 1 ? `_${input.index}` : ''
  return `${safeLabel}_${input.width}x${input.height}${suffix}.${extensionForMime(input.mimeType)}`
}

export function downloadFailureMessage(error: unknown) {
  const raw = error instanceof Error ? error.message.trim() : ''
  if (!raw || /failed to fetch|networkerror|load failed|err_failed/i.test(raw)) {
    return '下载失败：无法读取结果图片'
  }
  return raw.includes('下载失败') ? raw : `下载失败：${raw}`
}

function isInlineSource(source: string) {
  return source.startsWith('blob:')
    || source.startsWith('data:')
    || source.startsWith('/')
    || !/^[a-z][a-z0-9+.-]*:/i.test(source)
}

async function fetchSourceBlob(source: string) {
  const response = await fetch(source)
  if (!response.ok) throw new Error('读取图片失败')
  return response.blob()
}

export async function blobFromImageSource(source: Blob | string, objectKey?: string) {
  if (typeof source !== 'string') return source
  if (objectKey) return fetchOwnedObject(objectKey)
  if (isInlineSource(source)) return fetchSourceBlob(source)
  throw new Error('读取图片失败')
}

export async function downloadImageSource(source: Blob | string, filename: string, objectKey?: string) {
  try {
    const blob = await normalizeImageBlob(await blobFromImageSource(source, objectKey))
    downloadBlob(blob, filenameWithMimeExtension(filename, blob.type))
  } catch (error) {
    throw Object.assign(new Error(downloadFailureMessage(error)), { cause: error })
  }
}

export async function downloadImageAsset(asset: ImageAsset, filename?: string) {
  await downloadImageSource(
    asset.url,
    filename ?? filenameForWorkstationResult({
      toolLabel: asset.name || '结果',
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
    }),
    asset.objectKey,
  )
}
