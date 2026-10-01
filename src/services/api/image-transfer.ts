import { authEnabled, supabase } from '@/cloud/client'
import { readOwnedImage, OwnedImageReadError } from './ownedImages'
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

/** 读取失败保留对象描述，只读取已有结果，不重新生成。 */
export async function downloadImageResult(payload: SyncImageObjectResult, tool: string, signal?: AbortSignal, ownerId?: string) {
  try { return await readOwnedImage(payload, { signal, ownerId }) }
  catch (error) {
    if (error instanceof OwnedImageReadError) throw new ImageResultError(error.status, `读取${tool}结果失败：${error.message}`)
    if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') throw new ImageResultError(error.status, `读取${tool}结果地址失败，请重试读取`)
    throw error
  }
}

export interface ImageResultReadOptions {
  ownerId?: string
  expectedMime?: SyncImageObjectResult['mimeType']
  signal?: AbortSignal
  onObjectResult?: (result: SyncImageObjectResult) => void
}

export async function readImageResult(response: Response, tool: string, options: ImageResultReadOptions = {}) {
  const expectedMime = options.expectedMime ?? 'image/jpeg'
  if (response.headers.get('Content-Type')?.split(';')[0].trim() === expectedMime) {
    try { return await response.blob() }
    catch { throwIfImageRequestAborted(options.signal); throw new Error('内联结果读取中断，无法恢复图片；请主动重新生成') }
  }
  const payload = await response.json().catch(() => null) as SyncImageObjectResult | null
  if (!payload?.objectKey || !payload.url || payload.mimeType !== expectedMime) throw new Error(`${tool}没有返回图片`)
  options.onObjectResult?.(payload)
  return downloadImageResult(payload, tool, options.signal, options.ownerId)
}
