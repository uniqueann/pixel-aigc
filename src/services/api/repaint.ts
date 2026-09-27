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

function mimeTypeFor(blob: Blob) {
  if (blob.type === 'image/jpeg' || blob.type === 'image/png' || blob.type === 'image/webp') return blob.type
  return 'image/jpeg'
}

/** 原图加同尺寸黑白蒙版。返回裁回原图尺寸、未涂抹区域保持原像素的 JPEG。 */
export async function requestRepaint(image: Blob, mask: Blob, prompt: string) {
  const text = prompt.trim().slice(0, 800)
  if (!text) throw new Error('请先填写重绘描述')
  const response = await fetch('/api/repaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify({
      mimeType: mimeTypeFor(image),
      dataBase64: await fileToBase64(image),
      maskBase64: await fileToBase64(mask),
      prompt: text,
    }),
    signal: AbortSignal.timeout(115000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '重绘失败')
  }
  if (!response.headers.get('Content-Type')?.startsWith('image/')) throw new Error('重绘没有返回图片')
  return response.blob()
}
