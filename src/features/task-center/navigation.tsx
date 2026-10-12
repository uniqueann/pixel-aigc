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
function RouteDraftBlocker() {
  const context = useContext(Context)!
  const { message } = App.useApp()
  const handling = useRef(false)
  const blocker = useBlocker(({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname
    && [...context.guards.values()].some(read => {const guard=read();return guard.dirty||guard.blocked}))
  useEffect(() => {
    if (blocker.state !== 'blocked' || handling.current) return
    handling.current = true
    let active = true
    const resolve = async () => {
      const session=useUserStore.getState(),owner=session.userId,scope=session.account?.runtimeScope
      const guards = [...context.guards.values()].map(read => read())
      const saved = new Set<typeof guards[number]>()
      const blocked = guards.find(guard => guard.blocked)?.blocked
      let allowed = !blocked
      if (blocked) message.warning(blocked)
      if (allowed) for (const guard of guards) {
        if (guard.beforeLeave) {
          const result=await guard.beforeLeave()
          if(!result){message.error('当前内容未能保存，请先处理保存问题');allowed=false;break}
          if(result==='saved')saved.add(guard)
        }
      }
      const unsaved=guards.filter(guard=>guard.dirty&&!saved.has(guard))
      if (allowed && unsaved.length) allowed = await context.confirmReplace(unsaved.map(guard => guard.reason).join('；'))
      const current=useUserStore.getState()
      allowed=allowed&&current.userId===owner&&current.account?.runtimeScope===scope
      if (active) { if (allowed) blocker.proceed(); else blocker.reset() }
      handling.current = false
    }
    void resolve().catch(() => { if (active) { message.error('保存失败，请处理当前内容后再切换'); blocker.reset() }; handling.current = false })
    return () => { active = false }
  }, [blocker, context, message])
  return null
}
