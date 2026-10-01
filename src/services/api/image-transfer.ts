import { authEnabled, supabase } from '@/cloud/client'
import { signedOwnedObjectUrl } from './objects'

export const INLINE_IMAGE_BYTES = Math.floor(3.5 * 1024 * 1024)
export const MAX_IMAGE_BYTES = 20 * 1024 * 1024

export async function imageAuthHeader(): Promise<Record<string, string>> {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export function fileToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

export function imageMimeType(blob: Blob, fallback = 'image/jpeg') {
  if (blob.type === 'image/jpeg' || blob.type === 'image/png' || blob.type === 'image/webp') return blob.type
  if (fallback === 'image/jpeg' || fallback === 'image/png' || fallback === 'image/webp') return fallback
  return 'image/jpeg'
}

export function pngMaskBlob(mask: Blob | string, emptyMessage: string, invalidMessage: string) {
  if (typeof mask !== 'string') return mask
  const encoded = mask.trim().replace(/^data:[^,]*,/, '')
  if (!encoded) throw new Error(emptyMessage)
  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return new Blob([bytes], { type: 'image/png' })
  } catch {
    throw new Error(invalidMessage)
  }
}

function encodedLength(size: number) {
  return 4 * Math.ceil(size / 3)
}

export function shouldUseInlineImageTransport(imageBytes: number, maskBytes: number, extra: string, sourceObjectKey?: string) {
  if (sourceObjectKey) return false
  return encodedLength(imageBytes) + encodedLength(maskBytes) + new TextEncoder().encode(extra).byteLength + 4096 <= INLINE_IMAGE_BYTES
}

export function clientTiming(prepareStarted: number, uploadMs: number) {
  return {
    prepare: Math.max(0, Math.min(300_000, Math.round(performance.now() - prepareStarted - uploadMs))),
    upload: Math.min(300_000, uploadMs),
  }
}

export async function readImageResult(response: Response, tool: string) {
  if (response.headers.get('Content-Type')?.startsWith('image/')) return response.blob()
  const payload = await response.json().catch(() => null) as {
    objectKey?: string
    url?: string
    mimeType?: string
  } | null
  if (!payload?.objectKey || !payload.url || payload.mimeType !== 'image/jpeg') throw new Error(`${tool}没有返回图片`)
  let downloaded = await fetch(payload.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null)
  if (!downloaded || downloaded.status === 403) {
    const refreshed = await signedOwnedObjectUrl(payload.objectKey)
    downloaded = await fetch(refreshed, { signal: AbortSignal.timeout(60_000) }).catch(() => null)
  }
  if (!downloaded?.ok || !downloaded.headers.get('Content-Type')?.startsWith('image/')) {
    throw new Error(`读取${tool}结果失败，请重试`)
  }
  return downloaded.blob()
}
