import { createClient } from '@supabase/supabase-js'
export const cloudEnabled = import.meta.env.VITE_CLOUD_MODE === 'enabled'
export const authEnabled = import.meta.env.VITE_AUTH_MODE === undefined ? cloudEnabled : import.meta.env.VITE_AUTH_MODE === 'enabled'
export const cloudConfigurationError = cloudEnabled && !authEnabled ? '云同步需要先启用账号系统' :
  authEnabled && (!/^https?:\/\//.test(import.meta.env.VITE_SUPABASE_URL ?? '') || !import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY)
    ? '请先配置 Supabase URL 和 publishable key，再启用账号系统' : undefined
export const supabase = authEnabled && !cloudConfigurationError ? createClient(import.meta.env.VITE_SUPABASE_URL!, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!, {
  auth: { flowType: 'pkce', storageKey: 'pixel-aigc-auth', detectSessionInUrl: false },
}) : null
export class CloudError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message) }
}
export async function cloudRequest<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  if (!supabase) throw new CloudError(503, '账号服务未启用', 'AUTH_DISABLED')
  const { data } = await supabase!.auth.getSession()
  const response = await fetch(`/api${path}`, { method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000),
  })
  const result = await response.json().catch(() => ({ error: '账号服务暂时不可用', code: 'SERVICE_UNAVAILABLE' }))
  if (!response.ok) throw new CloudError(response.status, result.error ?? '请求失败', result.code)
  return result as T
}
