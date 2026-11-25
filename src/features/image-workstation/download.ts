import { normalizeImageBlob } from '@shared/image-format'
import { i18n } from '@/i18n'
import zhWorkstation from '@/i18n/locales/zh-CN/workstation.json'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import type { ImageAsset } from '@/editor/types'
import { readOwnedImage } from '@/services/api/ownedImages'
import { runtimeImageBlob } from '@/services/api/imageRuntime'

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
  const trimmed = name.trim() || i18n.t('workstation:files.defaultImageName')
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
  const safeLabel = input.toolLabel.replace(/[\\/:*?"<>|]+/g, '').trim() || i18n.t('workstation:files.defaultResultName')
  const suffix = input.index && input.index > 1 ? `_${input.index}` : ''
  return `${safeLabel}_${input.width}x${input.height}${suffix}.${extensionForMime(input.mimeType)}`
}

export function downloadFailureMessage(error: unknown) {
  const raw = error instanceof Error ? error.message.trim() : ''
  if (!raw || /failed to fetch|networkerror|load failed|err_failed/i.test(raw)) {
    return i18n.t('workstation:errors.downloadReadFailed')
  }
  const prefix = i18n.t('workstation:errors.downloadFailedPrefix')
  const word = i18n.t('workstation:errors.downloadFailedWord')
  if (raw.startsWith(prefix) || raw.includes(word) || raw.includes(zhWorkstation.errors.downloadFailedWord)) {
    return raw
  }
  return `${prefix}${raw}`
}

function isInlineSource(source: string) {
  return source.startsWith('blob:')
    || source.startsWith('data:')
    || source.startsWith('/')
    || !/^[a-z][a-z0-9+.-]*:/i.test(source)
}

async function fetchSourceBlob(source: string, signal?: AbortSignal) {
  const response = await fetch(source, signal ? { signal } : undefined)
  if (!response.ok) throw new Error(i18n.t('errors:client.imageReadFailed'))
  return response.blob()
}

export async function blobFromImageSource(source: Blob | string, objectKey?: string, options: { ownerId?: string; signal?: AbortSignal } = {}) {
  if (options.signal?.aborted) throw new DOMException(i18n.t('errors:client.readCancelled'), 'AbortError')
  if (typeof source !== 'string') return source
  const runtime = runtimeImageBlob(source)
  if (runtime) return runtime
  if (objectKey) return readOwnedImage({ objectKey }, options)
  if (isInlineSource(source)) return fetchSourceBlob(source, options.signal)
  throw new Error(i18n.t('errors:client.imageReadFailed'))
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
      toolLabel: asset.name || i18n.t('workstation:files.defaultResultName'),
      width: asset.width,
      height: asset.height,
      mimeType: asset.mimeType,
    }),
    asset.objectKey ?? asset.storage?.objectKey,
  )
}
