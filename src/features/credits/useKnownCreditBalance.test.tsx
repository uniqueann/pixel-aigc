// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'

const refreshBillingBalance = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('@/cloud/client', () => ({ authEnabled: true }))
vi.mock('@/services/api/billing', () => ({ refreshBillingBalance }))

import { useKnownCreditBalance } from './useKnownCreditBalance'

function Probe() {
  const balance = useKnownCreditBalance()
  return <span>{balance === undefined ? '未知' : String(balance)}</span>
}

describe('已知积分余额', () => {
  afterEach(() => {
    cleanup()
    refreshBillingBalance.mockClear()
    useUserStore.setState({ userId: null, credits: 0, creditsLoaded: false })
  })

  it('还没读到余额时不把缓存里的 0 当成已知', () => {
    useUserStore.setState({ userId: 'owner', credits: 0, creditsLoaded: false })
    render(<Probe />)
    expect(screen.getByText('未知')).toBeTruthy()
    expect(refreshBillingBalance).toHaveBeenCalledWith('owner')
  })

  it('读到余额后返回数字，未登录不刷新', () => {
    useUserStore.setState({ userId: 'owner', credits: 2, creditsLoaded: true })
    const view = render(<Probe />)
    expect(screen.getByText('2')).toBeTruthy()
    view.unmount()
    refreshBillingBalance.mockClear()
    useUserStore.setState({ userId: null, credits: 2, creditsLoaded: true })
    render(<Probe />)
    expect(screen.getByText('未知')).toBeTruthy()
    expect(refreshBillingBalance).not.toHaveBeenCalled()
  })
})
