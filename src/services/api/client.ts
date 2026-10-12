import { authEnabled, supabase } from '@/cloud/client'
import axios from 'axios'
import { useUserStore } from '@/store/useUserStore'

export class ApiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string,
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
    throw new ApiError('账号或环境已切换，旧请求已停止', 401, 'ACCOUNT_CHANGED')
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
    throw new ApiError('登录账号已切换', 401, 'ACCOUNT_CHANGED')
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
    const serverMessage = err.response?.data?.error
    if (err.response?.status === 402 && typeof window !== 'undefined')
      window.dispatchEvent(new Event('aigc:recharge'))
    return Promise.reject(
      new ApiError(
        serverMessage || err.message || '请求失败，请重试',
        err.response?.status,
        err.response?.data?.code,
      ),
    )
  },
)
