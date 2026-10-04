import { authEnabled, supabase } from '@/cloud/client'
import axios from 'axios'

export class ApiError extends Error {
  constructor(message: string, public status?: number, public code?: string) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

apiClient.interceptors.request.use(async (config) => {
  const token = authEnabled ? (await supabase!.auth.getSession()).data.session?.access_token : localStorage.getItem('access_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

apiClient.interceptors.response.use(
  (res) => res.data,
  (err) => {
    // 统一错误处理：401 跳转登录、其余交给调用方 catch
    if (err.response?.status === 401) {
      if (authEnabled) window.location.href = '/login'
    }
    const serverMessage = err.response?.data?.error
    if (err.response?.status === 402 && typeof window !== 'undefined') window.dispatchEvent(new Event('aigc:recharge'))
    return Promise.reject(new ApiError(serverMessage || err.message || '请求失败，请重试', err.response?.status, err.response?.data?.code))
  },
)
