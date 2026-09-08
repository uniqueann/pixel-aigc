import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Space } from 'antd'
import { cloudEnabled, cloudConfigurationError, cloudRequest, supabase } from './client'
import { setPersistenceUser } from '@/editor/persistence/database'
import { useUserStore } from '@/store/useUserStore'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'login' | 'ready' | 'error'>(cloudConfigurationError ? 'error' : cloudEnabled ? 'loading' : 'ready')
  const [error, setError] = useState(cloudConfigurationError ?? '')
  useEffect(() => {
    if (!supabase) return
    let disposed = false
    let mountedUser: string | undefined
    const initialize = async () => {
      const { data, error: sessionError } = await supabase!.auth.getSession()
      if (disposed) return
      if (sessionError) throw sessionError
      if (!data.session) { setState('login'); return }
      const member = await cloudRequest<{ userId: string; email: string }>('/me', 'POST')
      if (disposed) return
      mountedUser = member.userId
      setPersistenceUser(member.userId)
      useUserStore.getState().setUser(member.email, 'free')
      setState('ready')
    }
    void initialize().catch(err => { if (!disposed) { setError(String(err.message)); setState('error') } })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // 身份变化后重启页面，清除编辑器、查询缓存和旧账号的运行时 URL。
      if (mountedUser && session?.user.id !== mountedUser) window.location.reload()
    })
    return () => { disposed = true; listener.subscription.unsubscribe() }
  }, [])
  if (state === 'ready') return children
  return <div className="project-recovery-screen">
    <h2>Pixel AIGC</h2>
    {state === 'loading' ? <p>正在验证账号…</p> : <>
      <Alert type={state === 'error' ? 'error' : 'info'} message={error || '请使用受邀的 Google 账号登录'} />
      <Space>
        <Button disabled={!supabase} type="primary" onClick={() => {
          void supabase!.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin + '/', queryParams: { prompt: 'select_account' } } })
            .then(({ error: authError }) => { if (authError) setError(authError.message) })
        }}>Google 登录</Button>
        <Button onClick={() => { window.location.reload() }}>重试</Button>
        {state === 'error' && supabase && <Button onClick={() => { void supabase!.auth.signOut({ scope: 'local' }).then(() => window.location.reload()) }}>切换账号</Button>}
      </Space>
    </>}
  </div>
}
