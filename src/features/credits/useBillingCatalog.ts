import { useEffect, useState } from 'react'
import { QueryClient, useQuery, useQueryClient } from '@tanstack/react-query'
import { authEnabled } from '@/cloud/client'
import { BILLING_REFRESH_EVENT, getBillingCatalog } from '@/services/api/billing'
import { useUserStore } from '@/store/useUserStore'

export const billingRuntimeScope = `${import.meta.env.MODE}:${import.meta.env.VITE_CLOUD_MODE ?? 'local'}`
const subscriptions = new WeakMap<QueryClient, { count: number; refresh: () => void }>()

function subscribeRefresh(client: QueryClient) {
  let subscription = subscriptions.get(client)
  if (!subscription) {
    subscription = { count: 0, refresh: () => {
      const owner = useUserStore.getState().userId
      if (owner) void client.invalidateQueries({ queryKey: ['billing-catalog', billingRuntimeScope, owner] }, { cancelRefetch: false })
    } }
    subscriptions.set(client, subscription)
    window.addEventListener(BILLING_REFRESH_EVENT, subscription.refresh)
  }
  subscription.count++
  return () => {
    if (--subscription.count === 0) {
      window.removeEventListener(BILLING_REFRESH_EVENT, subscription.refresh)
      subscriptions.delete(client)
    }
  }
}

export function billingMonth(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).formatToParts(now)
  return `${parts.find(part => part.type === 'year')!.value}-${parts.find(part => part.type === 'month')!.value}`
}

/** 按账号共享目录，事件刷新只影响当前账号；旧请求不能覆盖新账号。 */
export function useBillingCatalog(enabled = true) {
  const owner = useUserStore(state => state.userId)
  const [month, setMonth] = useState(billingMonth)
  const client = useQueryClient()
  const query = useQuery({
    queryKey: ['billing-catalog', billingRuntimeScope, owner, month],
    queryFn: ({ signal }) => getBillingCatalog(owner!, signal),
    enabled: enabled && authEnabled && !!owner,
    staleTime: 30_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  useEffect(() => {
    if (!enabled || !owner) return
    const unsubscribe = subscribeRefresh(client)
    const timer = window.setInterval(() => setMonth(billingMonth()), 30_000)
    return () => { unsubscribe(); window.clearInterval(timer) }
  }, [client, enabled, owner])
  return query
}
