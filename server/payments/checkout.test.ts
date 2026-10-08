import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  validate: vi.fn(),
  checkout: vi.fn(),
  providers: vi.fn(),
  currency: vi.fn(),
}))
vi.mock('../db.js', () => ({
  database: () => ({ begin: async (fn: (sql: typeof mocks.sql) => Promise<unknown>) => fn(mocks.sql) }),
  runtimeScope: () => 'preview',
  withIdentity: async (_id: string, _email: string, fn: (sql: typeof mocks.sql) => Promise<unknown>) => fn(mocks.sql),
}))
vi.mock('./providers.js', () => ({
  configuredProviders: mocks.providers,
  createPaymentCheckout: mocks.checkout,
  creditCurrency: mocks.currency,
  paymentMode: () => 'test',
  productId: () => 'prod_starter',
  readPaymentReceipt: vi.fn(),
  record: (value: unknown) => value,
  validateProduct: mocks.validate,
  verifyPaymentEvent: vi.fn(),
}))
import { createCreditCheckout } from './service.js'
import { CREDIT_PACKS } from '../../shared/billing.js'

const user = { id: '00000000-0000-4000-8000-000000000311', email: 'buyer@example.com' }
const orderId = '00000000-0000-4000-8000-000000000312'
function orderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: orderId, pack_id: 'starter', provider: 'dodo', amount: 990, currency: 'CNY', credits: 100,
    status: 'pending', checkout_url: null, refund_requested: false, created_at: '2026-10-05T00:00:00.000Z',
    payment_id: null, ...overrides,
  }
}
function queries() {
  return mocks.sql.mock.calls.map(call => Array.from(call[0] as TemplateStringsArray).join(''))
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.providers.mockReturnValue(['dodo']); mocks.currency.mockReturnValue('CNY')
  vi.stubEnv('AIGC_PUBLIC_ORIGIN', 'https://pay.example.com')
  mocks.validate.mockResolvedValue(undefined)
  mocks.checkout.mockResolvedValue({ id: 'ch_new', url: 'https://checkout.dodopayments.com/session' })
})

describe('Creem 美元套餐下单', () => {
  it.each(CREDIT_PACKS)('$name 按美元金额保存订单，并交给 Creem 创建付款', async pack => {
    mocks.providers.mockReturnValue(['dodo', 'creem']); mocks.currency.mockReturnValue('USD')
    const row = orderRow({ provider: 'creem', pack_id: pack.id, amount: pack.USD, currency: 'USD', credits: pack.credits })
    mocks.checkout.mockResolvedValue({ id: 'ch_creem', url: 'https://checkout.creem.io/aigc' })
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = Array.from(parts).join('')
      if (query.includes('ensure_credit_account')) return [{ balance: 30 }]
      if (query.includes('lock_credit_account_for_checkout')) return [{ payment_blocked: false }]
      if (query.includes('from aigc.credit_orders where id=')) return []
      if (query.includes('count(*)')) return [{ count: 0 }]
      if (query.includes('insert into aigc.credit_orders')) return [row]
      if (query.includes('checkout_id=')) return [{ ...row, checkout_id: 'ch_creem', checkout_url: 'https://checkout.creem.io/aigc' }]
      return []
    })
    const created = await createCreditCheckout(user, { orderId, packId: pack.id, provider: 'creem', expectedAmount: pack.USD, expectedCurrency: 'USD' })
    expect(created).toMatchObject({ provider: 'creem', currency: 'USD', amount: pack.USD, credits: pack.credits })
    expect(mocks.validate).toHaveBeenCalledWith('creem', 'prod_starter', pack.USD, 'USD')
    expect(mocks.checkout).toHaveBeenCalledWith(row, user.email, `https://pay.example.com/?creditOrder=${orderId}`)
  })
  it('Creem 未开放时不创建订单或支付链接', async () => {
    mocks.currency.mockReturnValue('USD')
    await expect(createCreditCheckout(user, { orderId, packId: 'starter', provider: 'creem', expectedAmount: 299, expectedCurrency: 'USD' })).rejects.toMatchObject({ code: 'PAYMENT_UNCONFIGURED' })
    expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.validate).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled()
  })
  it('旧人民币目录或过期价格不能创建新的美元付款', async () => {
    mocks.currency.mockReturnValue('USD'); mocks.providers.mockReturnValue(['dodo', 'creem'])
    for (const expected of [{ expectedAmount: 990, expectedCurrency: 'CNY' }, { expectedAmount: 199, expectedCurrency: 'USD' }]) {
      await expect(createCreditCheckout(user, { orderId, packId: 'starter', provider: 'creem', ...expected })).rejects.toMatchObject({ code: 'PRICE_CHANGED' })
    }
    expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled()
  })
})

describe('充值下单不再直接锁积分账户', () => {
  it('用定义者函数锁账户，再插入订单并回写支付链接', async () => {
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = Array.from(parts).join('')
      if (query.includes('ensure_credit_account')) return [{ balance: 30 }]
      if (query.includes('lock_credit_account_for_checkout')) return [{ payment_blocked: false }]
      if (query.includes('from aigc.credit_orders where id=')) return []
      if (query.includes('count(*)')) return [{ count: 0 }]
      if (query.includes('insert into aigc.credit_orders')) return [orderRow()]
      if (query.includes('checkout_id=')) return [orderRow({ checkout_id: 'ch_new', checkout_url: 'https://checkout.dodopayments.com/session' })]
      return []
    })
    const order = await createCreditCheckout(user, {
      orderId, packId: 'starter', provider: 'dodo', expectedAmount: 990, expectedCurrency: 'CNY',
    })
    expect(order).toMatchObject({ id: orderId, checkoutUrl: 'https://checkout.dodopayments.com/session', status: 'pending' })
    const text = queries().join('\n')
    expect(text).toContain('aigc.lock_credit_account_for_checkout')
    expect(text).not.toContain('for update')
    expect(text).not.toContain('from aigc.credit_accounts')
    expect(mocks.sql.mock.calls.some(call => Array.from(call[0] as TemplateStringsArray).join('').includes('lock_credit_account_for_checkout') && call[1] === user.id)).toBe(true)
  })
  it('账户已冻结时拒绝下单，且不插入订单', async () => {
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = Array.from(parts).join('')
      if (query.includes('ensure_credit_account')) return [{ balance: 30 }]
      if (query.includes('lock_credit_account_for_checkout')) return [{ payment_blocked: true }]
      return []
    })
    await expect(createCreditCheckout(user, {
      orderId, packId: 'starter', provider: 'dodo', expectedAmount: 990, expectedCurrency: 'CNY',
    })).rejects.toMatchObject({ status: 409, code: 'CREDIT_ACCOUNT_REVIEW' })
    expect(queries().some(query => query.includes('insert into aigc.credit_orders'))).toBe(false)
    expect(mocks.checkout).not.toHaveBeenCalled()
  })
})
