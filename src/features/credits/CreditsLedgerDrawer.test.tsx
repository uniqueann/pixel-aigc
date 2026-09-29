// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'

const listCreditLedger = vi.fn()
vi.mock('@/services/api/credits', () => ({
  listCreditLedger: (...args: unknown[]) => listCreditLedger(...args),
}))

import CreditsLedgerDrawer from './CreditsLedgerDrawer'

afterEach(() => cleanup())

describe('积分明细抽屉', () => {
  beforeEach(() => {
    listCreditLedger.mockReset()
    useUserStore.setState({
      credits: 4,
      account: {
        userId: 'u1', email: 'a@b.c', emailVerified: true, displayName: '测试', credits: 4,
        avatarUrl: null, providers: ['email'], status: 'active',
        workspace: { id: 'w1', name: '空间', type: 'personal', role: 'admin' },
      },
    })
  })

  it('打开后展示流水，并可加载下一页', async () => {
    listCreditLedger.mockResolvedValueOnce({
      balance: 97,
      nextCursor: 'c1',
      items: [{
        id: '1', createdAt: '2026-09-29T08:00:00.000Z', kind: 'settle', label: '结算退回',
        title: '精修 1K×1', summary: '精修 1K×1 实扣 2', delta: 1, deltaText: '+1',
        balanceAfter: 97, charged: 2, reason: null,
      }],
    }).mockResolvedValueOnce({
      balance: 97,
      nextCursor: null,
      items: [{
        id: '2', createdAt: '2026-09-29T07:00:00.000Z', kind: 'grant', label: '赠送/充值',
        title: '', summary: '', delta: 100, deltaText: '+100',
        balanceAfter: 100, charged: null, reason: '首次赠送',
      }],
    })
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('精修 1K×1 实扣 2')).toBeTruthy()
    expect(screen.getByText('+1')).toBeTruthy()
    expect(screen.getByText('余额 97')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByText('首次赠送')).toBeTruthy()
    expect(listCreditLedger).toHaveBeenNthCalledWith(2, 'c1')
    expect(useUserStore.getState().credits).toBe(97)
  })

  it('没有流水时展示空状态', async () => {
    listCreditLedger.mockResolvedValue({ balance: 100, items: [], nextCursor: null })
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('还没有积分流水')).toBeTruthy()
  })
})
