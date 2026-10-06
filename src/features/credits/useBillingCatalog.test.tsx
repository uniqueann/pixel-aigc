// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BillingCatalog } from '@shared/billing'
import { useUserStore } from '@/store/useUserStore'
import { BILLING_REFRESH_EVENT, getBillingCatalog } from '@/services/api/billing'
import { billingMonth, useBillingCatalog } from './useBillingCatalog'

vi.mock('@/cloud/client', () => ({ authEnabled: true }))
vi.mock('@/services/api/billing', () => ({ BILLING_REFRESH_EVENT: 'aigc:billing-refresh', getBillingCatalog: vi.fn() }))
const catalog = (free: number): BillingCatalog => ({ currency: 'USD', providers: [], packs: [], balance: 100, paymentBlocked: false, priceVersion: 'v1', freeBgRemoveMonth: billingMonth(), freeBgRemoveRemaining: free })
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  return { client, wrapper }
}

describe('计费目录的刷新与账号隔离', () => {
  beforeEach(() => { vi.mocked(getBillingCatalog).mockReset(); useUserStore.setState({ userId: 'account-a' }) })
  afterEach(() => { cleanup(); useUserStore.setState({ userId: null }); vi.useRealTimers() })

  it('切换账号后立即清除旧报价，旧请求迟到也不会覆盖新账号', async () => {
    let resolveOld!: (value: BillingCatalog) => void
    vi.mocked(getBillingCatalog).mockImplementation(owner => owner === 'account-a' ? new Promise(resolve => { resolveOld = resolve }) : Promise.resolve(catalog(2)))
    const { wrapper } = setup()
    const { result } = renderHook(() => useBillingCatalog(), { wrapper })
    await waitFor(() => expect(getBillingCatalog).toHaveBeenCalledTimes(1))
    act(() => useUserStore.setState({ userId: 'account-b' }))
    expect(result.current.data).toBeUndefined()
    await waitFor(() => expect(result.current.data?.freeBgRemoveRemaining).toBe(2))
    await act(async () => { resolveOld(catalog(20)); await Promise.resolve() })
    expect(result.current.data?.freeBgRemoveRemaining).toBe(2)
  })

  it('多个组件复用同一次查询，扣费或充值后事件刷新免费额度', async () => {
    vi.mocked(getBillingCatalog).mockResolvedValueOnce(catalog(20)).mockResolvedValue(catalog(19))
    const { wrapper } = setup()
    const { result } = renderHook(() => [useBillingCatalog(), useBillingCatalog()], { wrapper })
    await waitFor(() => expect(result.current.every(query => query.data?.freeBgRemoveRemaining === 20)).toBe(true))
    expect(getBillingCatalog).toHaveBeenCalledTimes(1)
    act(() => window.dispatchEvent(new Event(BILLING_REFRESH_EVENT)))
    await waitFor(() => expect(result.current.every(query => query.data?.freeBgRemoveRemaining === 19)).toBe(true))
    expect(getBillingCatalog).toHaveBeenCalledTimes(2)
  })

  it('请求失败可重试，不提供假的免费额度', async () => {
    vi.mocked(getBillingCatalog).mockRejectedValueOnce(new Error('网络错误')).mockResolvedValue(catalog(3))
    const { wrapper } = setup()
    const { result } = renderHook(() => useBillingCatalog(), { wrapper })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.data).toBeUndefined()
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.data?.freeBgRemoveRemaining).toBe(3))
  })

  it('月度额度边界使用上海时间，与服务端一致', () => {
    expect(billingMonth(new Date('2026-10-31T15:59:59Z'))).toBe('2026-10')
    expect(billingMonth(new Date('2026-10-31T16:00:00Z'))).toBe('2026-11')
  })
})
