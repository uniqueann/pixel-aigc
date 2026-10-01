import { authEnabled, supabase } from '@/cloud/client'
import { signedOwnedObjectUrl } from './objects'
import type { SyncImageObjectResult } from '@shared/sync-image'

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

export class ImageResultError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'ImageResultError' }
}

export function throwIfImageRequestAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('处理已取消', 'AbortError')
}

function downloadSignal(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000)
}

/** 下载失败只刷新地址，不通过服务器代理图片，也不重复生成。 */
export async function downloadImageResult(payload: SyncImageObjectResult, tool: string, signal?: AbortSignal) {
  throwIfImageRequestAborted(signal)
  let downloaded = await fetch(payload.url, { signal: downloadSignal(signal) }).catch(error => {
    throwIfImageRequestAborted(signal)
    if (error instanceof Error && error.name === 'TimeoutError') throw new ImageResultError(504, `读取${tool}结果超时，请重试`)
    return null
  })
  if (!downloaded || downloaded.status === 403) {
    await downloaded?.body?.cancel()
    const refreshed = signal ? await signedOwnedObjectUrl(payload.objectKey, signal) : await signedOwnedObjectUrl(payload.objectKey)
    downloaded = await fetch(refreshed, { signal: downloadSignal(signal) }).catch(() => {
      throwIfImageRequestAborted(signal)
      return null
    })
  }
  if (!downloaded?.ok || downloaded.headers.get('Content-Type')?.split(';')[0].trim() !== payload.mimeType) {
    await downloaded?.body?.cancel()
    throw new ImageResultError(downloaded?.status ?? 502, `读取${tool}结果失败，请重试`)
  }
  try { return await downloaded.blob() }
  catch {
    throwIfImageRequestAborted(signal)
    throw new ImageResultError(502, `读取${tool}结果中断，请重试`)
  }
}

export async function readImageResult(response: Response, tool: string, options: {
  expectedMime?: SyncImageObjectResult['mimeType']
  signal?: AbortSignal
  onObjectResult?: (result: SyncImageObjectResult) => void
} = {}) {
  const expectedMime = options.expectedMime ?? 'image/jpeg'
  if (response.headers.get('Content-Type')?.split(';')[0].trim() === expectedMime) return response.blob()
  const payload = await response.json().catch(() => null) as SyncImageObjectResult | null
  if (!payload?.objectKey || !payload.url || payload.mimeType !== expectedMime) throw new Error(`${tool}没有返回图片`)
  options.onObjectResult?.(payload)
  return downloadImageResult(payload, tool, options.signal)
}
