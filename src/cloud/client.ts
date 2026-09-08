import { createClient } from '@supabase/supabase-js'
export const cloudEnabled = import.meta.env.VITE_CLOUD_MODE === 'enabled'
export const cloudConfigurationError = cloudEnabled && (!/^https?:\/\//.test(import.meta.env.VITE_SUPABASE_URL ?? '') || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) ? '请先配置 Supabase URL 和 publishable key，再启用云端模式' : undefined
export const supabase = cloudEnabled && !cloudConfigurationError ? createClient(import.meta.env.VITE_SUPABASE_URL!, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { flowType: 'pkce', storageKey: 'pixel-aigc-auth', detectSessionInUrl: true },
}) : null
export class CloudError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function cloudRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const { data } = await supabase!.auth.getSession()
  const response = await fetch(`/api${path}`, { method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  })
  const result = await response.json()
  if (!response.ok) throw new CloudError(response.status, result.error ?? '请求失败')
  return result as T
}
