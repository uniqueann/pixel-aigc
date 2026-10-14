// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'

const listCreditLedger = vi.fn()
const recoverSyncResult = vi.fn()
vi.mock('@/services/api/credits', () => ({
  listCreditLedger: (...args: unknown[]) => listCreditLedger(...args),
}))
vi.mock('@/services/api/billing', () => ({
  BILLING_REFRESH_EVENT: 'aigc:billing-refresh',
  recoverSyncResult: (...args: unknown[]) => recoverSyncResult(...args),
}))
vi.mock('./RechargePanel', () => ({ default: () => null }))

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
        id: '1', createdAt: '2026-09-29T08:00:00.000Z', kind: 'settle', label: '精修 1K×1',
        title: '精修 1K×1', summary: '实扣 2', delta: -2, deltaText: '-2',
        balanceAfter: 98, charged: 2, reason: null,
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
    expect(await screen.findByText('精修 1K×1')).toBeTruthy()
    expect(screen.getByText('购买积分 · 余额 97')).toBeTruthy()
    expect(screen.getByText('实扣 2')).toBeTruthy()
    expect(screen.getByText('-2')).toBeTruthy()
    expect(screen.getByText('余额 98')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '加载更多' }))
    expect(await screen.findByText('首次赠送')).toBeTruthy()
    expect(listCreditLedger).toHaveBeenNthCalledWith(2, 'c1')
    expect(useUserStore.getState().credits).toBe(97)
  })

  it('没有流水时展示空状态', async () => {
    listCreditLedger.mockResolvedValue({ balance: 100, items: [], nextCursor: null })
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('还没有积分流水')).toBeTruthy()
    expect(screen.getByText('购买积分 · 余额 100')).toBeTruthy()
  })

  it('点击查询已有结果后展示找回图片卡片、提示与下载操作', async () => {
    recoverSyncResult.mockResolvedValue({
      state: 'settled',
      result: { url: 'https://example.com/test-result.png', byteLength: 1024, mimeType: 'image/png' },
    })
    listCreditLedger.mockResolvedValueOnce({
      balance: 100,
      nextCursor: null,
      items: [{
        id: '1', createdAt: '2026-10-14T08:00:00.000Z', kind: 'settle', label: '免费抠图',
        title: '免费抠图', summary: '本月免费额度', delta: 0, deltaText: '免费',
        balanceAfter: 100, charged: 0, reason: null, syncRequestId: 'sync-req-123',
      }],
    })
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('免费抠图')).toBeTruthy()
    const queryBtn = screen.getByRole('button', { name: '查询已有结果' })
    expect(queryBtn).toBeTruthy()
    fireEvent.click(queryBtn)
    expect(await screen.findByText('结果已找回')).toBeTruthy()
    expect(screen.getByText('临时保留 7 天')).toBeTruthy()
    expect(screen.getByText('打开结果图片 ↗')).toBeTruthy()
    expect(screen.getByRole('button', { name: '下载' })).toBeTruthy()
    expect(screen.getByRole('img', { name: '生成结果预览' })).toBeTruthy()
    expect(recoverSyncResult).toHaveBeenCalledWith('sync-req-123', 'u1')
  })

  it('顶部摘要卡片展示可用余额，点击立即充值切换到充值套餐 Tab', async () => {
    listCreditLedger.mockResolvedValueOnce({
      balance: 150,
      nextCursor: null,
      items: [{
        id: '1', createdAt: '2026-10-14T08:00:00.000Z', kind: 'grant', label: '购买充值',
        title: '', summary: '', delta: 150, deltaText: '+150',
        balanceAfter: 150, charged: null, reason: '充值 150 积分',
      }],
    })
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('可用积分余额')).toBeTruthy()
    expect(screen.getByText('150')).toBeTruthy()
    const rechargeToggleBtn = screen.getByRole('button', { name: '立即充值' })
    expect(rechargeToggleBtn).toBeTruthy()
    fireEvent.click(rechargeToggleBtn)
    expect(screen.getByRole('button', { name: '查看明细' })).toBeTruthy()
  })

  it('支持分类筛选消耗、赠送与退款，无匹配项时展示筛选空状态', async () => {
    listCreditLedger.mockResolvedValueOnce({
      balance: 90,
      nextCursor: null,
      items: [
        {
          id: '1', createdAt: '2026-10-14T08:00:00.000Z', kind: 'settle', label: '文生图 2K',
          title: '文生图 2K', summary: '扣减 4', delta: -4, deltaText: '-4',
          balanceAfter: 90, charged: 4, reason: null,
        },
        {
          id: '2', createdAt: '2026-10-14T07:00:00.000Z', kind: 'grant', label: '新人赠送',
          title: '', summary: '', delta: 30, deltaText: '+30',
          balanceAfter: 94, charged: null, reason: '注册礼包',
        },
      ],
    })
    render(<CreditsLedgerDrawer open onClose={() => undefined} />)
    expect(await screen.findByText('文生图 2K')).toBeTruthy()
    expect(screen.getByText('新人赠送')).toBeTruthy()

    // 切换到「消耗扣费」
    fireEvent.click(screen.getByRole('radio', { name: '消耗扣费' }))
    expect(screen.getByText('文生图 2K')).toBeTruthy()
    expect(screen.queryByText('新人赠送')).toBeNull()

    // 切换到「充值赠送」
    fireEvent.click(screen.getByRole('radio', { name: '充值赠送' }))
    expect(screen.queryByText('文生图 2K')).toBeNull()
    expect(screen.getByText('新人赠送')).toBeTruthy()

    // 切换到「失败退款」（没有退款流水）
    fireEvent.click(screen.getByRole('radio', { name: '失败退款' }))
    expect(screen.queryByText('文生图 2K')).toBeNull()
    expect(screen.queryByText('新人赠送')).toBeNull()
    expect(screen.getByText('暂无该分类的明细记录')).toBeTruthy()

    // 切换回「全部」
    fireEvent.click(screen.getByRole('radio', { name: '全部' }))
    expect(screen.getByText('文生图 2K')).toBeTruthy()
    expect(screen.getByText('新人赠送')).toBeTruthy()
  })

  it('支持指定 initialTab="recharge"，直接打开充值与套餐 Tab', async () => {
    listCreditLedger.mockResolvedValueOnce({
      balance: 10,
      nextCursor: null,
      items: [],
    })
    render(<CreditsLedgerDrawer open initialTab="recharge" onClose={() => undefined} />)
    expect(await screen.findByRole('button', { name: '查看明细' })).toBeTruthy()
  })
})

