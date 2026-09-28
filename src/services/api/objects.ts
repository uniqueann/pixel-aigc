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
