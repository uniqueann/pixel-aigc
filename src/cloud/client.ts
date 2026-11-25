import { createClient } from '@supabase/supabase-js'
import { i18n } from '@/i18n'
import { extractErrorExtra, extractRequestId, translateApiError } from '@/i18n/apiErrors'
import { apiErrorCode, responseErrorText } from '@/services/api/apiErrorText'

export const cloudEnabled = import.meta.env.VITE_CLOUD_MODE === 'enabled'
export const authEnabled = import.meta.env.VITE_AUTH_MODE === undefined ? cloudEnabled : import.meta.env.VITE_AUTH_MODE === 'enabled'
const supabaseUrl = import.meta.env.VITE_AIGC_SUPABASE_URL || import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_AIGC_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

export function getCloudConfigurationError(): string | undefined {
  if (cloudEnabled && !authEnabled) return i18n.t('auth:cloudConfig.syncNeedsAuth')
  if (authEnabled && (!/^https?:\/\//.test(supabaseUrl ?? '') || !supabaseKey)) {
    return i18n.t('auth:cloudConfig.missingSupabase')
  }
  return undefined
}

export const cloudConfigurationError = getCloudConfigurationError()

export const supabase = authEnabled && !cloudConfigurationError ? createClient(supabaseUrl!, supabaseKey!, {
  auth: { flowType: 'pkce', storageKey: 'pixel-aigc-auth', detectSessionInUrl: false },
}) : null

export class CloudError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = 'REQUEST_FAILED',
    public extra?: Record<string, unknown>,
  ) {
    super(message)
  }
}

export interface CloudRequestOptions { timeoutMs?: number; expectedUserId?: string; signal?: AbortSignal }

export async function cloudRequest<T>(path: string, method = 'GET', body?: unknown, options?: CloudRequestOptions): Promise<T> {
  if (!supabase) throw new CloudError(503, i18n.t('auth:cloudConfig.authDisabled'), 'AUTH_DISABLED')
  options?.signal?.throwIfAborted()
  const { data } = await supabase!.auth.getSession()
  if (options?.expectedUserId && data.session?.user.id !== options.expectedUserId) {
    throw new CloudError(401, i18n.t('auth:cloudConfig.accountChanged'), 'ACCOUNT_CHANGED')
  }
  options?.signal?.throwIfAborted()
  const timeout = AbortSignal.timeout(options?.timeoutMs ?? 60000)
  const response = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout,
  })
  const result = await response.json().catch(() => ({
    error: i18n.t('errors:generic.serviceUnavailableStatus', { status: response.status }),
    code: 'SERVICE_UNAVAILABLE',
  }))
  options?.signal?.throwIfAborted()
  if (options?.expectedUserId) {
    const latest = await supabase.auth.getSession()
    if (latest.data.session?.user.id !== options.expectedUserId) {
      throw new CloudError(401, i18n.t('auth:cloudConfig.accountChanged'), 'ACCOUNT_CHANGED')
    }
  }
  options?.signal?.throwIfAborted()
  if (!response.ok) {
    if (response.status === 402 && typeof window !== 'undefined') window.dispatchEvent(new Event('aigc:recharge'))
    const code = apiErrorCode(result)
    const extra = extractErrorExtra(result)
    const requestId = extractRequestId(result)
    const message = translateApiError({
      code,
      extra,
      message: responseErrorText(result),
      status: response.status,
      requestId,
      fallback: i18n.t('errors:generic.requestFailed'),
    })
    throw new CloudError(response.status, message, code, extra)
  }
  return result as T
}
