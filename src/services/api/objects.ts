import { authEnabled, supabase } from '@/cloud/client'

export async function fetchOwnedObject(objectKey: string, filename?: string) {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  const params = new URLSearchParams({ key: objectKey })
  if (filename) {
    params.set('download', '1')
    params.set('filename', filename)
  }
  const response = await fetch(`/api/objects?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '读取结果失败')
  }
  return response.blob()
}

export class OwnedObjectError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'OwnedObjectError' }
}

export async function signedOwnedObjectUrl(objectKey: string, signal?: AbortSignal) {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  const params = new URLSearchParams({ key: objectKey, mode: 'url' })
  const response = await fetch(`/api/objects?${params}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(signal ? { signal } : {}),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new OwnedObjectError(response.status, payload?.error || '读取图片地址失败')
  }
  const signed = await response.json() as { url?: string; expiresAt?: number }
  if (!signed.url) throw new Error('未取得图片地址')
  return signed.url
}

export async function fetchOwnedObjectDirect(objectKey: string) {
  const response = await fetch(await signedOwnedObjectUrl(objectKey)).catch(() => null)
  if (!response?.ok) return fetchOwnedObject(objectKey)
  return response.blob()
}
