import { useEffect } from 'react'
import { authEnabled } from '@/cloud/client'
import { refreshBillingBalance } from '@/services/api/billing'
import { useUserStore } from '@/store/useUserStore'

/** 进入工具、回到窗口时刷新余额。还没读到时返回 undefined，避免用缓存里的 0 误拦。 */
export function useKnownCreditBalance() {
  const owner = useUserStore(state => state.userId)
  const credits = useUserStore(state => state.credits)
  const loaded = useUserStore(state => state.creditsLoaded)
  useEffect(() => {
    if (!owner || !authEnabled) return
    const refresh = () => { void refreshBillingBalance(owner).catch(() => undefined) }
    const onFocus = () => {
      if (document.visibilityState === 'hidden') return
      refresh()
    }
    refresh()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onFocus)
    }
  }, [owner])
  return owner && loaded ? credits : undefined
}
