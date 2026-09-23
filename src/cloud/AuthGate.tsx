import { useEffect, useState, type ReactNode } from 'react'
import { Alert, Button, Space } from 'antd'
import { authEnabled, cloudConfigurationError, cloudRequest, supabase, CloudError } from './client'
import { setPersistenceUser } from '@/editor/persistence/database'
import { useUserStore, type AccountContext } from '@/store/useUserStore'

export default function AuthGate({ children }: { children: ReactNode }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>(authEnabled ? 'loading' : 'ready')
  const [error, setError] = useState(cloudConfigurationError ?? '')
  useEffect(() => {
    const client = supabase
    if (!client || cloudConfigurationError) return
    let disposed = false
    let mountedUser: string | undefined
    const initialize = async () => {
      const { data, error: sessionError } = await client.auth.getSession()
      if (disposed) return
      if (sessionError) throw sessionError
      if (!data.session) {
        const next = window.location.pathname + window.location.search
        window.location.replace(`/login?next=${encodeURIComponent(next)}`)
        return
      }
      const member = await cloudRequest<AccountContext>('/me', 'POST')
      if (disposed) return
      mountedUser = member.userId
      setPersistenceUser(member.userId)
      useUserStore.getState().setAccount(member)
      setState('ready')
    }
    void initialize().catch(err => {
      if (disposed) return
      if (err instanceof CloudError && err.code === 'MEMBER_DISABLED') {
        window.location.replace('/account-disabled')
        return
      }
      setError(err instanceof Error ? err.message : '账号初始化失败')
      setState('error')
    })
    const { data: listener } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || mountedUser && session?.user.id !== mountedUser) {
        useUserStore.getState().setAccount(null)
        setPersistenceUser('')
        window.location.reload()
      }
    })
    return () => { disposed = true; listener.subscription.unsubscribe() }
  }, [])
  if (cloudConfigurationError) return <div className="project-recovery-screen"><Alert type="error" message={cloudConfigurationError} /></div>
  if (state === 'ready') return children
  return <div className="project-recovery-screen">
    <h2>Pixel AIGC</h2>
    {state === 'loading' ? <p>正在验证账号…</p> : <>
      <Alert type="error" message={error} />
      <Space><Button onClick={() => window.location.reload()}>重试</Button>
        <Button onClick={() => { void supabase?.auth.signOut({ scope: 'local' }).then(() => window.location.replace('/login')) }}>切换账号</Button></Space>
    </>}
  </div>
}
