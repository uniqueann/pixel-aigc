import { useCallback, useContext, useEffect, useMemo, useRef,useState, type ReactNode } from 'react'
import { App } from 'antd'
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'

import { DraftNavigationContext as Context,type DraftGuard } from './draftNavigationContext'
export function TaskNavigationProvider({ children }: { children: ReactNode }) {
  const { modal } = App.useApp()
  const router = useContext(UNSAFE_DataRouterContext)
  const [guards] = useState(() => new Map<object, () => DraftGuard>())
  const confirmReplace = useCallback((reason: string) => new Promise<boolean>(resolve => {
    const state = useUserStore.getState(), owner = state.userId, scope = state.account?.runtimeScope
    modal.confirm({ title: '当前内容尚未保存', content: reason, okText: '放弃草稿并继续', cancelText: '留在当前页',
      onOk: () => { const now = useUserStore.getState(); resolve(now.userId === owner && now.account?.runtimeScope === scope) }, onCancel: () => resolve(false) })
  }), [modal])
  const value = useMemo(() => ({ guards, confirmReplace }),[guards,confirmReplace])
  return <Context.Provider value={value}>
    {router ? <RouteDraftBlocker /> : null}{children}
  </Context.Provider>
}
function draftNavigationBlocks(current: { pathname: string; search: string }, next: { pathname: string; search: string }) {
  if (current.pathname !== next.pathname) return true
  if (!current.pathname.startsWith('/canvas/')) return false
  const from = new URLSearchParams(current.search).get('task')
  const to = new URLSearchParams(next.search).get('task')
  return to !== null && from !== to
}
function RouteDraftBlocker() {
  const context = useContext(Context)!
  const { message } = App.useApp()
  const handling = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => draftNavigationBlocks(currentLocation, nextLocation)
    && [...context.guards.values()].some(read => {const guard=read();return guard.dirty||guard.blocked}))
  useEffect(() => {
    if (blocker.state !== 'blocked' || handling.current) return
    handling.current = true
    let active = true
    const resolve = async () => {
      const guards = [...context.guards.values()].map(read => read())
      const blocked = guards.find(guard => guard.blocked)?.blocked
      let allowed = !blocked
      if (blocked) message.warning(blocked)
      if (allowed) for (const guard of guards) {
        if (guard.beforeLeave && !await guard.beforeLeave()) { allowed = false; break }
      }
      if (allowed && guards.some(guard => guard.dirty)) allowed = await context.confirmReplace(guards.filter(guard => guard.dirty).map(guard => guard.reason).join('；'))
      if (allowed) for (const guard of guards) if (guard.dirty) await guard.onAbandon?.()
      if (active) { if (allowed) blocker.proceed(); else blocker.reset() }
      handling.current = false
    }
    void resolve().catch(() => { if (active) { message.error('保存失败，请处理当前内容后再切换'); blocker.reset() }; handling.current = false })
    return () => { active = false }
  }, [blocker, context, message])
  return null
}
