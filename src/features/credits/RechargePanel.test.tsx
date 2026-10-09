// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
import { CREDIT_PACKS, type BillingCatalog, type CreditOrder, type PaymentProvider } from '@shared/billing'
import type { CreditDiscountPreview } from '@shared/credit-discounts'

const api = vi.hoisted(() => ({ catalog: vi.fn(), orders: vi.fn(), checkout: vi.fn(), order: vi.fn(), refresh: vi.fn(), refund: vi.fn(), preview: vi.fn() }))
vi.mock('@/services/api/billing', () => ({
  BILLING_REFRESH_EVENT: 'aigc:billing-refresh', getBillingCatalog: api.catalog, listCreditOrders: api.orders,
  checkoutCredits: api.checkout, getCreditOrder: api.order, refreshBillingBalance: api.refresh, requestCashRefund: api.refund,
  previewCreditDiscount: api.preview,
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
// 保留真实按钮与点击行为；流程测试按按钮文本定位，避免反复计算 Antd 的整棵无障碍名称和样式。
function buttonByText(text: string | RegExp) {
  return screen.getByText(text, { selector: 'button span' }).closest('button')!
}
function purchaseButtons() {
  return screen.getAllByText(/^购\s*买$/, { selector: 'button span' }).map(label => label.closest('button')!)
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
  api.preview.mockResolvedValue(discountPreview())
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
  })
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
  })
  it('确认到账后刷新余额并通知父组件', async () => {
    const onPaid = vi.fn()
    api.orders.mockResolvedValue({ items: [order()] }); api.order.mockResolvedValue(order({ status: 'paid' }))
    render(<RechargePanel open onPaid={onPaid} />)
    fireEvent.click(await screen.findByRole('button', { name: '查询到账' }))
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1))
    expect(api.refresh).toHaveBeenCalledWith('owner-a')
  })
  it('退出登录后清空充值内容', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）')
    await act(async () => { useUserStore.setState({ userId: null }) })
    expect(screen.getByText('请先登录再购买积分')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /购\s*买/ })).toBeNull()
  })
})

function discountPreview(provider: PaymentProvider = 'dodo'): CreditDiscountPreview {
  return { provider, code: 'AIGC10', currency: 'USD', packs: CREDIT_PACKS.map(pack => {
    const payableAmount = Math.round(pack.USD * 0.9)
    return { packId: pack.id, available: true, amount: pack.USD, message: '优惠 10%',
      discount: { code: 'AIGC10', id: 'dis_aigc', percentBps: 1000, payableAmount, discountAmount: pack.USD - payableAmount } }
  }) }
}
const APPLIED = '太棒了！你节省了 10%！最终金额以结账页为准。'
async function enterDiscount(code = ' aigc10 ') {
  fireEvent.click(buttonByText('应用折扣代码'))
  fireEvent.change(screen.getByLabelText('折扣代码'), { target: { value: code } })
}
async function applyDiscount() {
  await enterDiscount()
  fireEvent.click(buttonByText('验证'))
  await screen.findByText(APPLIED)
}
// 保留真实 Antd 控件和接口断言，输入按标签定位；使用默认超时约束流程测试。
describe('验证折扣代码', () => {
  it('收起时是一行提示和描边按钮，展开后不能再收起', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）')
    expect(screen.getByText('有折扣代码吗？')).toBeTruthy()
    fireEvent.click(buttonByText('应用折扣代码'))
    expect(screen.queryByText('有折扣代码吗？')).toBeNull()
    expect(screen.queryByRole('button', { name: '应用折扣代码' })).toBeNull()
    const input = screen.getByLabelText('折扣代码') as HTMLInputElement
    expect(input.maxLength).toBe(14)
    expect(input.placeholder).toBe('折扣代码')
    fireEvent.change(input, { target: { value: 'ab' } })
    expect(input.value).toBe('AB')
    expect(buttonByText('验证').textContent).toBe('验证')
  })
  it('显示各档预计价格，携带规范化代码和预计应付下单，积分不改变', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await applyDiscount()
    const success = screen.getByText(APPLIED)
    expect(success.style.color).toBe('rgb(52, 211, 153)')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.getByText('预计 $2.69')).toBeTruthy(); expect(screen.getByText('预计 $6.29')).toBeTruthy()
    expect(screen.getByText('体验包 · 100 积分')).toBeTruthy()
    expect(api.preview).toHaveBeenCalledWith('dodo', 'AIGC10', 'USD', 'owner-a', expect.any(AbortSignal))
    fireEvent.click(purchaseButtons()[0])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'dodo', expect.any(String), 'owner-a', 299, 'USD', { discountCode: 'AIGC10', expectedPayableAmount: 269 }))
  })
  it('无效码不会默默按原价下单，清空输入后恢复原价购买', async () => {
    api.preview.mockResolvedValue({ ...discountPreview(), code: 'NOPE', packs: discountPreview().packs.map(pack => ({ ...pack, available: false, discount: null, message: '折扣码不存在' })) })
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await enterDiscount('NOPE')
    fireEvent.click(buttonByText('验证')); await screen.findByText('折扣码不存在')
    const input = screen.getByLabelText('折扣代码')
    expect(input.className).toContain('status-error')
    fireEvent.click(purchaseButtons()[0])
    await screen.findByText('请先点击验证。'); expect(api.checkout).not.toHaveBeenCalled()
    fireEvent.change(input, { target: { value: '' } }); fireEvent.click(purchaseButtons()[0])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'dodo', expect.any(String), 'owner-a', 299, 'USD'))
  })
  it('部分套餐适用，其他套餐明确按原价购买且不传优惠', async () => {
    const result = discountPreview(); result.packs[0] = { ...result.packs[0], available: false, discount: null, message: '此折扣码不适用于当前套餐' }
    api.preview.mockResolvedValue(result)
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await applyDiscount()
    fireEvent.click(buttonByText('按原价购买'))
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'dodo', expect.any(String), 'owner-a', 299, 'USD'))
  })
  it('改码立即使报价失效，迟到的旧验证不能恢复优惠', async () => {
    const pending = deferred<CreditDiscountPreview>(); api.preview.mockReturnValue(pending.promise)
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await enterDiscount()
    fireEvent.click(buttonByText('验证'))
    fireEvent.change(screen.getByLabelText('折扣代码'), { target: { value: 'AIGC20' } })
    await act(async () => pending.resolve(discountPreview()))
    expect(screen.queryByText('预计 $2.69')).toBeNull()
    fireEvent.click(purchaseButtons()[0]); expect(api.checkout).not.toHaveBeenCalled()
  })
  it('切换付款方式保留已输入代码并清报价，未重新验证不能购买', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await applyDiscount(); await selectCreem()
    expect(screen.queryByText('预计 $2.69')).toBeNull()
    expect(screen.queryByText(APPLIED)).toBeNull()
    expect(screen.getByText('付款方式已更换，请重新验证。')).toBeTruthy()
    expect((screen.getByLabelText('折扣代码') as HTMLInputElement).value).toBe('AIGC10')
    fireEvent.click(purchaseButtons()[0])
    await screen.findByText('请先点击验证。'); expect(api.checkout).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('折扣代码'), { target: { value: '' } })
    fireEvent.click(purchaseButtons()[0])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'creem', expect.any(String), 'owner-a', 299, 'USD'))
  })
  it('切换通道时放弃尚未返回的验证，不能恢复旧报价', async () => {
    const pending = deferred<CreditDiscountPreview>(); api.preview.mockReturnValueOnce(pending.promise)
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await enterDiscount('AIGC10')
    fireEvent.click(buttonByText('验证')); await selectCreem()
    expect(screen.getByText('付款方式已更换，请重新验证。')).toBeTruthy()
    await act(async () => pending.resolve(discountPreview()))
    expect(screen.queryByText('预计 $2.69')).toBeNull()
    expect((screen.getByLabelText('折扣代码') as HTMLInputElement).value).toBe('AIGC10')
  })
  it('仅展开折扣代码时切换通道，输入区仍保持展开且不提示', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）')
    fireEvent.click(buttonByText('应用折扣代码'))
    await selectCreem()
    expect((screen.getByLabelText('折扣代码') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('付款方式已更换，请重新验证。')).toBeNull()
  })
  it('关闭后重新打开不保留已应用优惠', async () => {
    const view = render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await applyDiscount()
    view.rerender(<RechargePanel open={false} onPaid={() => undefined} />)
    view.rerender(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('有折扣代码吗？'); expect(screen.queryByText('预计 $2.69')).toBeNull()
    expect(screen.queryByLabelText('折扣代码')).toBeNull()
  })
  it('切换账号清空已应用优惠，新账号购买不带旧账号代码', async () => {
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await applyDiscount()
    await act(async () => useUserStore.setState({ userId: 'owner-b' }))
    await screen.findByText('有折扣代码吗？'); expect(screen.queryByLabelText('折扣代码')).toBeNull()
    expect(screen.queryByText('预计 $2.69')).toBeNull()
    fireEvent.click(purchaseButtons()[0])
    await waitFor(() => expect(api.checkout).toHaveBeenCalledWith('starter', 'dodo', expect.any(String), 'owner-b', 299, 'USD'))
  })
  it('订单展示最终实付和最终代码，不用预计报价替代付款金额', async () => {
    const quotedDiscount = discountPreview().packs[0].discount!
    api.orders.mockResolvedValue({ items: [order({ status: 'paid', quotedAmount: 269, paidAmount: 239, quotedDiscount,
      paidDiscount: { ...quotedDiscount, code: 'AIGC20', percentBps: 2000, discountAmount: 60, payableAmount: 239 } })] })
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('$2.39 · 100 分 · 已到账')
    expect(screen.getByText('原价 $2.99 · 折扣代码 AIGC20')).toBeTruthy()
  })
  it('优惠变化导致下单失败后清除报价，并要求重新验证', async () => {
    api.checkout.mockRejectedValue(new Error('优惠金额已更新，请重新应用折扣码后购买'))
    render(<RechargePanel open onPaid={() => undefined} />)
    await screen.findByText('支付币种：美元（USD）'); await applyDiscount()
    fireEvent.click(purchaseButtons()[0])
    await screen.findByText('优惠金额已更新，请重新应用折扣码后购买')
    expect(screen.queryByText('预计 $2.69')).toBeNull()
  })
})
