import { cloudEnabled, supabase } from '@/cloud/client'
import axios from 'axios'

export const apiClient = axios.create({
  baseURL: '/api',
  timeout: 15000,
})

apiClient.interceptors.request.use(async (config) => {
  const token = cloudEnabled ? (await supabase!.auth.getSession()).data.session?.access_token : localStorage.getItem('access_token')
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
      if (!cloudEnabled) window.location.href = '/login'
    }
    return Promise.reject(err)
  },
)
