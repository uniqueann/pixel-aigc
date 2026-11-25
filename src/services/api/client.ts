import { authEnabled, supabase } from '@/cloud/client'
import axios from 'axios'
import { i18n } from '@/i18n'
import { extractErrorExtra, extractRequestId, translateApiError } from '@/i18n/apiErrors'
import { useUserStore } from '@/store/useUserStore'
import { apiErrorCode, responseErrorText } from './apiErrorText'

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
    public extra?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

const requestActors = new WeakMap<
  object,
  { userId: string | null; scope: string | undefined }
>()
function checkRequestActor(config: object | undefined) {
  const actor = config ? requestActors.get(config) : undefined,
    current = useUserStore.getState()
  if (
    actor?.userId &&
    (actor.userId !== current.userId ||
      actor.scope !== current.account?.runtimeScope)
  )
    throw new ApiError(i18n.t('errors:generic.accountOrScopeChanged'), 401, 'ACCOUNT_CHANGED')
}
apiClient.interceptors.request.use(async (config) => {
  const current = useUserStore.getState()
  requestActors.set(config, {
    userId: current.userId,
    scope: current.account?.runtimeScope,
  })
  const session = authEnabled
    ? (await supabase!.auth.getSession()).data.session
    : null
  checkRequestActor(config)
  if (authEnabled && current.userId && session?.user.id !== current.userId)
    throw new ApiError(i18n.t('errors:generic.accountChanged'), 401, 'ACCOUNT_CHANGED')
  const token = authEnabled
    ? session?.access_token
    : localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (res) => {
    checkRequestActor(res.config)
    return res.data
  },
  (err) => {
    if (err instanceof ApiError) return Promise.reject(err)
    checkRequestActor(err.config)
    // 统一错误处理：401 跳转登录、其余交给调用方 catch
    if (err.response?.status === 401) {
      if (authEnabled) window.location.href = '/login'
    }
    if (err.response?.status === 402 && typeof window !== 'undefined')
      window.dispatchEvent(new Event('aigc:recharge'))
    const data = err.response?.data
    const code = apiErrorCode(data)
    const extra = extractErrorExtra(data)
    // 413 is often returned directly by the proxy/platform layer with raw English body.
    const message = translateApiError({
      code,
      extra,
      message: responseErrorText(data) || err.message || undefined,
      status: err.response?.status,
      requestId: extractRequestId(data),
      fallback: i18n.t('errors:generic.requestFailed'),
    })
    return Promise.reject(
      new ApiError(message, err.response?.status, code, extra),
    )
  },
)
