import { authEnabled, supabase } from '@/cloud/client'
import { signedOwnedObjectUrl } from './objects'
import { uploadTaskInput } from './upload'

const INLINE_REQUEST_BYTES = Math.floor(3.5 * 1024 * 1024)
const MAX_IMAGE_BYTES = 20 * 1024 * 1024

async function authHeader(): Promise<Record<string, string>> {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

function fileToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

function mimeTypeFor(blob: Blob, fallback: string) {
  if (blob.type === 'image/jpeg' || blob.type === 'image/png' || blob.type === 'image/webp') return blob.type
  if (fallback === 'image/jpeg' || fallback === 'image/png' || fallback === 'image/webp') return fallback
  return 'image/jpeg'
}

function maskBytesOf(mask: Blob | string) {
  if (typeof mask !== 'string') return Promise.resolve(mask)
  const encoded = mask.trim().replace(/^data:[^,]*,/, '')
  if (!encoded) throw new Error('请先涂抹要消除的区域')
  try {
    const binary = atob(encoded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return Promise.resolve(new Blob([bytes], { type: 'image/png' }))
  } catch {
    throw new Error('消除蒙版无效，请重新涂抹')
  }
}

function encodedLength(size: number) {
  return 4 * Math.ceil(size / 3)
}

export function shouldUseInlineEraseTransport(imageBytes: number, maskBytes: number, prompt: string, sourceObjectKey?: string) {
  if (sourceObjectKey) return false
  const promptBytes = new TextEncoder().encode(prompt).byteLength
  return encodedLength(imageBytes) + encodedLength(maskBytes) + promptBytes + 4096 <= INLINE_REQUEST_BYTES
}

async function readEraseResult(response: Response) {
  if (response.headers.get('Content-Type')?.startsWith('image/')) return response.blob()
  const payload = await response.json().catch(() => null) as {
    objectKey?: string
    url?: string
    mimeType?: string
  } | null
  if (!payload?.objectKey || !payload.url || payload.mimeType !== 'image/jpeg') throw new Error('消除没有返回图片')
  let downloaded = await fetch(payload.url, { signal: AbortSignal.timeout(60_000) }).catch(() => null)
  if (!downloaded || downloaded.status === 403) {
    const refreshed = await signedOwnedObjectUrl(payload.objectKey)
    downloaded = await fetch(refreshed, { signal: AbortSignal.timeout(60_000) }).catch(() => null)
  }
  if (!downloaded?.ok || !downloaded.headers.get('Content-Type')?.startsWith('image/')) {
    throw new Error('读取消除结果失败，请重试')
  }
  return downloaded.blob()
}

/** 小图沿用原路径，大图通过私有对象存储传输。 */
export async function requestErase(
  image: Blob | null,
  mimeType: string,
  mask: Blob | string,
  prompt = '',
  sourceObjectKey?: string,
) {
  const prepareStarted = performance.now()
  const painted = await maskBytesOf(mask)
  if (!painted.size || painted.size > MAX_IMAGE_BYTES) throw new Error('消除蒙版不能超过 20 MB')
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error('单张图片不能超过 20 MB')
  const inline = image && shouldUseInlineEraseTransport(image.size, painted.size, prompt, sourceObjectKey)
  let body: Record<string, unknown>
  let uploadMs = 0
  if (inline && image) {
    const [dataBase64, maskBase64] = await Promise.all([fileToBase64(image), fileToBase64(painted)])
    body = { mimeType: mimeTypeFor(image, mimeType), dataBase64, maskMimeType: 'image/png', maskBase64, prompt }
  } else {
    const uploadStarted = performance.now()
    const signal = AbortSignal.timeout(120_000)
    const [sourceImageKey, maskImageKey] = await Promise.all([
      sourceObjectKey ? Promise.resolve(sourceObjectKey) : uploadTaskInput(image!, mimeTypeFor(image!, mimeType), signal),
      uploadTaskInput(painted, 'image/png', signal),
    ])
    uploadMs = Math.round(performance.now() - uploadStarted)
    body = { sourceImageKey, maskImageKey, prompt }
  }
  body.clientTimingMs = {
    prepare: Math.max(0, Math.min(300_000, Math.round(performance.now() - prepareStarted - uploadMs))),
    upload: Math.min(300_000, uploadMs),
  }
  const response = await fetch('/api/erase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(115_000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '消除失败')
  }
  return readEraseResult(response)
}
