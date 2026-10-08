// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
import { CREDIT_PACKS, type BillingCatalog, type CreditOrder, type PaymentProvider } from '@shared/billing'

const api = vi.hoisted(() => ({ catalog: vi.fn(), orders: vi.fn(), checkout: vi.fn(), order: vi.fn(), refresh: vi.fn(), refund: vi.fn() }))
vi.mock('@/services/api/billing', () => ({
  BILLING_REFRESH_EVENT: 'aigc:billing-refresh', getBillingCatalog: api.catalog, listCreditOrders: api.orders,
  checkoutCredits: api.checkout, getCreditOrder: api.order, refreshBillingBalance: api.refresh, requestCashRefund: api.refund,
}))
// 计费说明有独立测试；这里保留真实的付款选择、按钮和退款弹窗。
vi.mock('./BillingExplanation', () => ({ default: () => null }))
import RechargePanel from './RechargePanel'

function catalog(providers: PaymentProvider[] = ['creem', 'dodo']): BillingCatalog {
  return { currency: 'USD', providers, balance: 30, paymentBlocked: false, priceVersion: 'v1', freeBgRemoveRemaining: 20, freeBgRemoveMonth: '2026-10',
    packs: CREDIT_PACKS.map(pack => ({ id: pack.id, name: pack.name, credits: pack.credits, amount: pack.USD, providers })) }
}
function order(overrides: Partial<CreditOrder> = {}): CreditOrder {
  return { id: 'order-a', packId: 'starter', provider: 'dodo', amount: 299, currency: 'USD', credits: 100,
    status: 'pending', checkoutUrl: null, refundRequested: false, createdAt: '2026-10-08T00:00:00Z', ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
async function selectCreem() {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '付款方式' }))
  fireEvent.click(await screen.findByText('Creem', { selector: '.ant-select-item-option-content' }))
}
beforeEach(() => {
  vi.clearAllMocks()
  useUserStore.setState({ userId: 'owner-a', account: null, credits: 0 })
  api.catalog.mockResolvedValue(catalog()); api.orders.mockResolvedValue({ items: [] })
  api.checkout.mockResolvedValue(order()); api.refresh.mockResolvedValue(undefined)
  const computedStyle = window.getComputedStyle.bind(window)
  vi.spyOn(window, 'getComputedStyle').mockImplementation(element => computedStyle(element))
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })) })
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('充值通道与美元价格', () => {
  it('双通道即使 Creem 排在目录首位也默认 Dodo，并使用美元套餐下单', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    expect(await screen.findByText('支付币种：美元（USD）')).toBeTruthy()
    expect(screen.getByText('$2.99')).toBeTruthy(); expect(screen.getByText('$6.99')).toBeTruthy(); expect(screen.getByText('$19.99')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: /购\s*买/ })[0])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'dodo', expect.any(String), 'owner-a', 299, 'USD'))
  })
  it('主动选择 Creem 后，刷新目录仍保留选择，不自动创建 Dodo 付款', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）')
    await selectCreem()
    await act(async () => { window.dispatchEvent(new Event('aigc:billing-refresh')) })
    await waitFor(() => expect(api.catalog).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getAllByRole('button', { name: /购\s*买/ })[1])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('standard', 'creem', expect.any(String), 'owner-a', 699, 'USD'))
    expect(api.checkout).toHaveBeenCalledTimes(1)
  })
  it('仅 Creem 可用时显示通道名称，并使用 Creem 下单', async () => {
    api.catalog.mockResolvedValue(catalog(['creem']))
    render(<RechargePanel open onPaid={() => undefined} />)
    expect(await screen.findByText('付款方式：Creem')).toBeTruthy()
    expect(screen.queryByRole('combobox')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /购\s*买/ })[0])
    await waitFor(() => expect(api.checkout.mock.calls[0][1]).toBe('creem'))
  })
  it('所选通道被关闭后回退 Dodo', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await selectCreem()
    api.catalog.mockResolvedValue(catalog(['dodo']))
    await act(async () => { window.dispatchEvent(new Event('aigc:billing-refresh')) })
    await screen.findByText('付款方式：Dodo Payments')
    fireEvent.click(screen.getAllByRole('button', { name: /购\s*买/ })[0])
    await waitFor(() => expect(api.checkout.mock.calls[0][1]).toBe('dodo'))
  })
  it('套餐不支持所选通道时禁用并说明原因，切换通道后才能购买', async () => {
    const next = catalog(); next.packs[0].providers = ['creem']
    api.catalog.mockResolvedValue(next)
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('此套餐暂不支持 Dodo Payments，可切换付款方式')
    expect((screen.getAllByRole('button', { name: /购\s*买/ })[0] as HTMLButtonElement).disabled).toBe(true)
    await selectCreem()
    expect((screen.getAllByRole('button', { name: /购\s*买/ })[0] as HTMLButtonElement).disabled).toBe(false)
  })
  it('没有通道和账户被冻结时不能购买', async () => {
    api.catalog.mockResolvedValue({ ...catalog([]), paymentBlocked: true })
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('充值尚未开放，当前可使用已有积分')
    expect(screen.getByText('账户存在待核对的支付记录，请联系支持')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /购\s*买/ }).every(button => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(api.checkout).not.toHaveBeenCalled()
  })
  it('Creem 下单失败时展示错误并保留所选通道，不自动向 Dodo 下单', async () => {
    api.checkout.mockRejectedValue(new Error('支付通道暂时不可用，请稍后查询订单'))
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await selectCreem()
    fireEvent.click(screen.getAllByRole('button', { name: /购\s*买/ })[0])
    await screen.findByText('支付通道暂时不可用，请稍后查询订单')
    expect(api.checkout).toHaveBeenCalledTimes(1); expect(api.checkout.mock.calls[0][1]).toBe('creem')
  })
  it('美元目录中的旧人民币订单仍显示原金额', async () => {
    api.orders.mockResolvedValue({ items: [order({ currency: 'CNY', amount: 990 })] })
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('¥9.90 · 100 分 · 等待支付确认')
    expect(screen.getByText('支付币种：美元（USD）')).toBeTruthy()
  })
})

describe('充值账号与异步结果隔离', () => {
  it('切换账号后清空旧订单、退款表单和付款选择', async () => {
    api.orders.mockResolvedValueOnce({ items: [order({ status: 'paid', provider: 'creem' })] })
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('申请退款'); await selectCreem()
    fireEvent.click(screen.getByRole('button', { name: '申请退款' }))
    fireEvent.change(await screen.findByPlaceholderText('请填写退款原因'), { target: { value: '账号 A 的原因' } })
    await act(async () => { useUserStore.setState({ userId: 'owner-b' }) })
    await waitFor(() => expect(api.catalog).toHaveBeenCalledWith('owner-b'))
    await screen.findByText('支付币种：美元（USD）')
    expect(screen.queryByPlaceholderText('请填写退款原因')).toBeNull()
    expect(screen.queryByText('充值订单')).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: /购\s*买/ })[0])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'dodo', expect.any(String), 'owner-b', 299, 'USD'))
  }, 15_000)
  it('旧账号晚到的目录不覆盖新账号余额和订单', async () => {
    const old = deferred<BillingCatalog>()
    api.catalog.mockReturnValueOnce(old.promise).mockResolvedValue({ ...catalog(), balance: 55 })
    api.orders.mockResolvedValueOnce({ items: [order()] }).mockResolvedValue({ items: [] })
    render(<RechargePanel open onPaid={() => undefined} />)
    await waitFor(() => expect(api.catalog).toHaveBeenCalledWith('owner-a'))
    await act(async () => { useUserStore.setState({ userId: 'owner-b' }) })
    await screen.findByText('支付币种：美元（USD）')
    await act(async () => { old.resolve({ ...catalog(), balance: 999 }) })
    expect(useUserStore.getState().credits).toBe(55)
    expect(screen.queryByText('充值订单')).toBeNull()
  })
  it('账号 A→B→A 后，旧面板的查单结果不会触发到账回调', async () => {
    const old = deferred<CreditOrder>(), onPaid = vi.fn()
    api.orders.mockResolvedValueOnce({ items: [order()] }).mockResolvedValue({ items: [] })
    api.order.mockReturnValue(old.promise)
    render(<RechargePanel open onPaid={onPaid} />)
    fireEvent.click(await screen.findByRole('button', { name: '查询到账' }))
    await act(async () => { useUserStore.setState({ userId: 'owner-b' }) })
    await screen.findByText('支付币种：美元（USD）')
    await act(async () => { useUserStore.setState({ userId: 'owner-a' }) })
    await screen.findByText('支付币种：美元（USD）')
    await act(async () => { old.resolve(order({ status: 'paid' })) })
    expect(onPaid).not.toHaveBeenCalled(); expect(api.refresh).not.toHaveBeenCalled()
  }, 15_000)
  it('确认到账后刷新余额并通知父组件', async () => {
    const onPaid = vi.fn()
    api.orders.mockResolvedValue({ items: [order()] }); api.order.mockResolvedValue(order({ status: 'paid' }))
    render(<RechargePanel open onPaid={onPaid} />)
    fireEvent.click(await screen.findByRole('button', { name: '查询到账' }))
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
    expect(api.refresh).toHaveBeenCalledWith('owner-a')
  }, 15_000)
  it('退出登录后清空充值内容', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）')
    await act(async () => { useUserStore.setState({ userId: null }) })
    expect(screen.getByText('请先登录再购买积分')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /购\s*买/ })).toBeNull()
  })
})
