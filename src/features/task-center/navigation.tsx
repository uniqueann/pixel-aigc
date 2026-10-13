import { useCallback, useContext, useEffect, useMemo, useRef,useState, type ReactNode } from 'react'
import { App } from 'antd'
import { UNSAFE_DataRouterContext, useBlocker,useLocation } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'

import { DraftNavigationContext as Context,type DraftGuard } from './draftNavigationContext'
export function TaskNavigationProvider({ children }: { children: ReactNode }) {
  const { modal } = App.useApp()
  const router = useContext(UNSAFE_DataRouterContext)
  const [guards] = useState(() => new Map<object, () => DraftGuard>())
  const confirmReplace = useCallback((reason: string) => new Promise<boolean>(resolve => {
    const state = useUserStore.getState(), owner = state.userId, scope = state.account?.runtimeScope
    modal.confirm({ title: '未保存的修改', content: reason, okText: '放弃并离开', cancelText: '留在此页',
      onOk: () => { const now = useUserStore.getState(); resolve(now.userId === owner && now.account?.runtimeScope === scope) }, onCancel: () => resolve(false) })
  }), [modal])
  const value = useMemo(() => ({ guards, confirmReplace }),[guards,confirmReplace])
  return <Context.Provider value={value}>
    {router ? <RouteDraftBlocker /> : null}{children}
  </Context.Provider>
}
function guardApplies(guard:DraftGuard,current:{pathname:string;search:string},next:{pathname:string;search:string}) {
  if(guard.navigationScope!=='canvas-task')return current.pathname!==next.pathname
  if(!current.pathname.startsWith('/canvas/'))return false
  if(!next.pathname.startsWith('/canvas/'))return true
  const from=new URLSearchParams(current.search),to=new URLSearchParams(next.search)
  return to.has('task')&&(['task','projectId','sceneId'].some(key=>from.get(key)!==to.get(key)))
}
function RouteDraftBlocker() {
  const context = useContext(Context)!
  const { message } = App.useApp()
  const handling = useRef(false)
  const location=useLocation()
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    [...context.guards.values()].some(read => {const guard=read();return guardApplies(guard,currentLocation,nextLocation)&&(guard.dirty||!!guard.blocked)}))
  useEffect(() => {
    if (blocker.state !== 'blocked' || handling.current) return
    handling.current = true
    let active = true
    const resolve = async () => {
      const session=useUserStore.getState(),owner=session.userId,scope=session.account?.runtimeScope
      const guards = [...context.guards.values()].map(read => read()).filter(guard=>guardApplies(guard,location,blocker.location))
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
      if(allowed&&active)for(const guard of unsaved) {
        await guard.onAbandon?.()
        const now=useUserStore.getState()
        allowed=now.userId===owner&&now.account?.runtimeScope===scope
        if(!allowed)break
      }
      if (active) { if (allowed) blocker.proceed(); else blocker.reset() }
      handling.current = false
    }
    void resolve().catch(() => { if (active) { message.error('保存失败，请处理当前内容后再切换'); blocker.reset() }; handling.current = false })
    return () => { active = false }
  }, [blocker, context, message,location])
  return null
}
