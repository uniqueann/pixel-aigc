import { useContext,useEffect,useRef } from 'react'
import { DraftNavigationContext,type DraftGuard } from './draftNavigationContext'
export function useTaskDraftGuard(guard:DraftGuard) {
  const context=useContext(DraftNavigationContext)
  const latest=useRef(guard)
  useEffect(()=>{latest.current=guard})
  useEffect(()=>{
    if(!context)return
    const key={}
    context.guards.set(key,()=>latest.current)
    return()=>{context.guards.delete(key)}
  },[context])
  return async(reason=guard.reason,force=false)=>{
    const current=latest.current
    if(current.blocked)return false
    return (!current.dirty&&!force)||(context?context.confirmReplace(reason):false)
  }
}
