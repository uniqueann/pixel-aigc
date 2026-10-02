import { useEffect, type ReactNode } from 'react'
import { authEnabled } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { usePreferencesStore } from './store'

export default function PreferencesGate({ children }: { children: ReactNode }) {
  const userId = useUserStore(state => state.userId)
  const owner = authEnabled ? userId ?? 'local' : 'local'
  const ready = usePreferencesStore(state => state.ready && state.owner === owner)
  useEffect(() => { void usePreferencesStore.getState().initialize(owner, authEnabled && Boolean(userId)) }, [owner, userId])
  useEffect(() => {
    const refresh = () => { void usePreferencesStore.getState().refresh() }
    const save = () => { void usePreferencesStore.getState().flush() }
    window.addEventListener('focus', refresh)
    window.addEventListener('online', refresh)
    window.addEventListener('pagehide', save)
    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('online', refresh)
      window.removeEventListener('pagehide', save)
    }
  }, [])
  if (!ready) return <div className="project-recovery-screen" role="status"><h2>Pixel AIGC</h2><p>正在加载个性化设置…</p></div>
  return <>{children}</>
}
