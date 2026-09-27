import { authEnabled, supabase } from '@/cloud/client'

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

function maskBase64Of(mask: Blob | string) {
  if (typeof mask === 'string') {
    const trimmed = mask.trim()
    if (!trimmed) throw new Error('请先涂抹要消除的区域')
    return Promise.resolve(trimmed.replace(/^data:[^,]*,/, ''))
  }
  return fileToBase64(mask)
}

/** 原图 + 同尺寸黑白蒙版交给服务端消除，返回拉回原图尺寸的 JPEG。 */
export async function requestErase(image: Blob, mimeType: string, mask: Blob | string, prompt = '') {
  const [dataBase64, maskBase64] = await Promise.all([fileToBase64(image), maskBase64Of(mask)])
  const response = await fetch('/api/erase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      mimeType: mimeTypeFor(image, mimeType),
      dataBase64,
      maskMimeType: 'image/png',
      maskBase64,
      prompt,
    }),
    signal: AbortSignal.timeout(115000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '消除失败')
  }
  if (!response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('消除没有返回图片')
  return response.blob()
}
