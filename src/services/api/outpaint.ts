import { authEnabled, supabase } from '@/cloud/client'
import { paddingAround, type PixelPadding } from '../../../shared/outpaint'

export { paddingAround }
export type { PixelPadding }

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

/** 把已经按留白坐标缩放好的原图交给服务端扩图，返回裁到精确目标尺寸的 JPEG。 */
export async function requestOutpaint(image: Blob, mimeType: string, padding: PixelPadding) {
  if (padding.left + padding.right + padding.top + padding.bottom <= 0) throw new Error('没有需要扩展的边缘')
  const dataBase64 = await fileToBase64(image)
  const response = await fetch('/api/outpaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({ mimeType: mimeTypeFor(image, mimeType), dataBase64, padding }),
    signal: AbortSignal.timeout(85000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '扩图失败')
  }
  if (!response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('扩图没有返回图片')
  return response.blob()
}
