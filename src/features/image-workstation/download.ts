import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import type { ImageAsset } from '@/editor/types'

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

export async function blobFromImageSource(source: Blob | string) {
  if (typeof source !== 'string') return source
  const response = await fetch(source)
  if (!response.ok) throw new Error('读取图片失败')
  return response.blob()
}

export async function downloadImageSource(source: Blob | string, filename: string) {
  downloadBlob(await blobFromImageSource(source), filename)
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
  )
}
