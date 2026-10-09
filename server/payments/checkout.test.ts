import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sql: Object.assign(vi.fn(), { json: (value: unknown) => value }),
  validate: vi.fn(),
  checkout: vi.fn(),
  providers: vi.fn(),
  currency: vi.fn(),
  discount: vi.fn(), quote: vi.fn(), limit: vi.fn(),
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
  readProviderDiscount: mocks.discount, quoteProviderDiscount: mocks.quote,
  record: (value: unknown) => value,
  validateProduct: mocks.validate,
  verifyPaymentEvent: vi.fn(),
}))
vi.mock('../sync-limits.js', () => ({ withSyncLimit: mocks.limit }))
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
  mocks.sql.mockResolvedValue([])
  mocks.providers.mockReturnValue(['dodo']); mocks.currency.mockReturnValue('CNY')
  vi.stubEnv('AIGC_PUBLIC_ORIGIN', 'https://pay.example.com')
  mocks.validate.mockResolvedValue(undefined)
  mocks.checkout.mockResolvedValue({ id: 'ch_new', url: 'https://checkout.dodopayments.com/session' })
  mocks.limit.mockImplementation((_user, _bucket, action) => action())
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
    expect(queries().some(query => query.includes('insert into'))).toBe(false); expect(mocks.validate).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled()
  })
  it('旧人民币目录或过期价格不能创建新的美元付款', async () => {
    mocks.currency.mockReturnValue('USD'); mocks.providers.mockReturnValue(['dodo', 'creem'])
    for (const expected of [{ expectedAmount: 990, expectedCurrency: 'CNY' }, { expectedAmount: 199, expectedCurrency: 'USD' }]) {
      await expect(createCreditCheckout(user, { orderId, packId: 'starter', provider: 'creem', ...expected })).rejects.toMatchObject({ code: 'PRICE_CHANGED' })
    }
    expect(queries().some(query => query.includes('insert into'))).toBe(false); expect(mocks.checkout).not.toHaveBeenCalled()
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

describe('折扣下单与冻结报价', () => {
  const discount = { id: 'dis_aigc', code: 'AIGC10', percentBps: 1000, payableAmount: 269, discountAmount: 30 }
  const input = { orderId, packId: 'starter', provider: 'creem', expectedAmount: 299, expectedCurrency: 'USD', discountCode: ' aigc10 ', expectedPayableAmount: 269 }
  beforeEach(() => {
    mocks.currency.mockReturnValue('USD'); mocks.providers.mockReturnValue(['dodo', 'creem'])
    mocks.discount.mockResolvedValue({ id: 'dis_aigc' }); mocks.quote.mockReturnValue(discount)
    const row = orderRow({ provider: 'creem', amount: 299, currency: 'USD', quoted_discount: discount })
    mocks.sql.mockImplementation(async (parts: TemplateStringsArray) => {
      const query = parts.join('')
      if (query.includes('ensure_credit_account')) return [{ balance: 30 }]
      if (query.includes('lock_credit_account_for_checkout')) return [{ payment_blocked: false }]
      if (query.includes('count(*)')) return [{ count: 0 }]
      if (query.includes('insert into aigc.credit_orders')) return [row]
      if (query.includes('update aigc.credit_orders')) return [{ ...row, checkout_id: 'ch_new', checkout_url: 'https://checkout.creem.io/test' }]
      return []
    })
  })
  it('重新核验折扣，原价与优惠快照一起保存，到账积分仍为原套餐', async () => {
    const result = await createCreditCheckout(user, input)
    expect(result).toMatchObject({ amount: 299, quotedAmount: 269, quotedDiscount: discount, credits: 100, paidAmount: null })
    expect(mocks.limit).toHaveBeenCalledWith(user, 'payment_discount', expect.any(Function))
    expect(mocks.discount).toHaveBeenCalledWith('creem', { code: 'AIGC10' })
    const insert = mocks.sql.mock.calls.find(([parts]) => parts.join('').includes('insert into aigc.credit_orders'))!
    expect(insert.at(-1)).toEqual(discount)
    expect(mocks.checkout.mock.calls[0][0].quoted_discount).toEqual(discount)
  })
  it('优惠价格变动或缺少预计应付时拒绝创建新订单', async () => {
    for (const expectedPayableAmount of [undefined, 239]) {
      await expect(createCreditCheckout(user, { ...input, expectedPayableAmount })).rejects.toMatchObject({ code: 'DISCOUNT_CHANGED' })
    }
    expect(queries().some(query => query.includes('insert into'))).toBe(false)
    expect(mocks.checkout).not.toHaveBeenCalled()
  })
  it('折扣失效或验证限流时，不创建原价付款作为替代', async () => {
    const { HttpError } = await import('../errors.js')
    mocks.discount.mockRejectedValueOnce(new HttpError(400, '折扣代码已过期', 'DISCOUNT_EXPIRED'))
    await expect(createCreditCheckout(user, input)).rejects.toMatchObject({ code: 'DISCOUNT_EXPIRED' })
    mocks.limit.mockRejectedValueOnce(new HttpError(429, '折扣验证已达到每小时上限', 'RATE_LIMIT'))
    await expect(createCreditCheckout(user, input)).rejects.toMatchObject({ status: 429 })
    expect(queries().some(query => query.includes('insert into'))).toBe(false)
    expect(mocks.checkout).not.toHaveBeenCalled()
  })
  it('重复同一订单使用冻结报价，券失效或目录改价不影响既有付款链接', async () => {
    const prior = orderRow({ provider: 'creem', amount: 299, currency: 'USD', quoted_discount: discount,
      checkout_id: 'ch_prior', checkout_url: 'https://checkout.creem.io/prior' })
    mocks.sql.mockResolvedValue([prior]); mocks.currency.mockReturnValue('CNY'); mocks.providers.mockReturnValue([])
    expect(await createCreditCheckout(user, input)).toMatchObject({ quotedAmount: 269, checkoutUrl: prior.checkout_url })
    expect(mocks.validate).not.toHaveBeenCalled(); expect(mocks.discount).not.toHaveBeenCalled(); expect(mocks.checkout).not.toHaveBeenCalled()
    await expect(createCreditCheckout(user, { ...input, discountCode: 'AIGC20' })).rejects.toMatchObject({ code: 'ORDER_CONFLICT' })
    await expect(createCreditCheckout(user, { ...input, expectedPayableAmount: 239 })).rejects.toMatchObject({ code: 'ORDER_CONFLICT' })
  })
})
