import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { discountPayableAmount, matchesDiscountPayment, normalizeCreditDiscountCode } from '../../shared/credit-discounts'

const mocks = vi.hoisted(() => ({ discount: vi.fn(), create: vi.fn(), checkout: vi.fn(), payment: vi.fn() }))
vi.mock('dodopayments', () => ({ default: class {
  discounts = { retrieveByCode: mocks.discount, retrieve: mocks.discount }
  checkoutSessions = { create: mocks.create, retrieve: mocks.checkout }
  payments = { retrieve: mocks.payment }
} }))
import { createPaymentCheckout, quoteProviderDiscount, readPaymentReceipt, readProviderDiscount, type PaymentOrderSnapshot } from './providers'

const order: PaymentOrderSnapshot = { id: '00000000-0000-4000-8000-000000000991', user_id: '00000000-0000-4000-8000-000000000992',
  scope: 'preview', provider: 'creem', provider_mode: 'test', product_id: 'prod_starter', amount: 299, currency: 'USD', credits: 100, checkout_id: 'ch_discount' }
const metadata = { productScope: 'aigc', orderId: order.id, userId: order.user_id, runtimeScope: 'preview', paymentMode: 'test' }
const quoted = { code: 'AIGC10', id: 'dis_aigc', percentBps: 1000, discountAmount: 30, payableAmount: 269 }
let creemRule: Record<string, unknown>, checkout: Record<string, unknown>, transaction: Record<string, unknown>
const fetchMock = vi.fn()
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview'); vi.stubEnv('AIGC_CREDIT_CURRENCY', 'USD')
  for (const provider of ['CREEM', 'DODO']) {
    vi.stubEnv(`AIGC_${provider}_TEST_API_KEY`, 'test_key'); vi.stubEnv(`AIGC_${provider}_TEST_WEBHOOK_SECRET`, 'test_secret')
    for (const pack of ['STARTER', 'STANDARD', 'STUDIO']) vi.stubEnv(`AIGC_${provider}_TEST_${pack}_PRODUCT_ID`, `prod_${pack.toLowerCase()}`)
  }
  creemRule = { id: 'dis_aigc', code: 'AIGC10', type: 'percentage', percentage: 10, applies_to_products: ['prod_starter'],
    mode: 'test', status: 'active', redeem_count: 0, max_redemptions: 100 }
  checkout = { id: order.checkout_id, request_id: order.id, status: 'completed', units: 1, metadata,
    product: { id: order.product_id, currency: 'USD', billing_type: 'onetime', tax_mode: 'inclusive' },
    discount: { id: 'dis_aigc', discountCode: 'AIGC10', type: 'percentage', amount: 10 },
    order: { id: 'ord_discount', product: order.product_id, amount: 299, amount_due: 269, amount_paid: 269,
      discount: 'dis_aigc', discount_amount: 30, currency: 'USD', type: 'onetime', status: 'paid', transaction: 'tran_discount' } }
  transaction = { id: 'tran_discount', order: 'ord_discount', amount_paid: 269, discount_amount: 30,
    currency: 'USD', type: 'payment', mode: 'test', status: 'paid', refunded_amount: 0 }
  fetchMock.mockImplementation(async (url: string) => {
    const path = new URL(url).pathname
    if (path === '/v1/discounts') return Response.json(creemRule)
    if (path === '/v1/checkouts') return Response.json(checkout)
    if (path === '/v1/transactions') return Response.json(transaction)
    throw new Error('测试中出现未知请求')
  })
  vi.stubGlobal('fetch', fetchMock)
  mocks.discount.mockResolvedValue({ discount_id: 'dis_aigc', code: 'AIGC10', type: 'percentage', amount: 1000,
    restricted_to: ['prod_starter'], times_used: 0, customer_eligibility: 'any' })
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

describe('折扣规则与平台预验证', () => {
  it('规范化代码，空码可省略，拒绝超长或特殊字符', () => {
    expect(normalizeCreditDiscountCode(' aigc10 ')).toBe('AIGC10'); expect(normalizeCreditDiscountCode(' ')).toBe('')
    for (const code of ['AIGC-10', '优惠10', 'A'.repeat(15)]) expect(() => normalizeCreditDiscountCode(code)).toThrow()
  })
  it('Creem 仅使用只读查询，两个平台统一换算为基点', async () => {
    expect((await readProviderDiscount('creem', { code: 'AIGC10' })).percentBps).toBe(1000)
    expect(fetchMock).toHaveBeenCalledWith('https://test-api.creem.io/v1/discounts?discount_code=AIGC10', expect.objectContaining({ method: 'GET' }))
    expect((await readProviderDiscount('dodo', { code: 'AIGC10' })).percentBps).toBe(1000)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it.each([
    { type: 'fixed' }, { percentage: 100 }, { percentage: 0 }, { applies_to_products: [] },
    { applies_to_products: ['prod_starter', 'prod_edm'] },
  ])('拒绝不支持的规则 %j', async change => {
    creemRule = { ...creemRule, ...change }
    await expect(readProviderDiscount('creem', { code: 'AIGC10' })).rejects.toMatchObject({ code: 'DISCOUNT_UNSUPPORTED' })
  })
  it('拒绝 Dodo 固定金额、资格限制、每人限次和币种封顶规则', async () => {
    const original = await mocks.discount()
    for (const changed of [{ type: 'flat' }, { customer_eligibility: 'first_time' }, { per_customer_usage_limit: 1 }, { currency_options: [{ currency: 'USD' }] }]) {
      mocks.discount.mockResolvedValue({ ...original, ...changed })
      await expect(readProviderDiscount('dodo', { code: 'AIGC10' })).rejects.toMatchObject({ code: 'DISCOUNT_UNSUPPORTED' })
    }
  })
  it('按商品、时间、次数检查，并拒绝错误环境', async () => {
    const rule = await readProviderDiscount('creem', { code: 'AIGC10' })
    expect(quoteProviderDiscount(rule, 'prod_starter', 299)).toEqual(quoted)
    for (const changed of [{ startsAt: '2999-01-01' }, { expiresAt: '2000-01-01' }, { usageLimit: 1, used: 1 }, { active: false }])
      expect(() => quoteProviderDiscount({ ...rule, ...changed }, 'prod_starter', 299)).toThrow()
    expect(() => quoteProviderDiscount(rule, 'prod_standard', 699)).toThrow('此折扣码不适用于当前套餐')
    creemRule.mode = 'prod'
    await expect(readProviderDiscount('creem', { code: 'AIGC10' })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
  })
  it('平台缺失计数、返回错误日期或错误规则类型时拒绝报价，不忽略限制', async () => {
    const original = { ...creemRule }
    for (const change of [{ redeem_count: undefined }, { redeem_count: -1 }, { max_redemptions: '100' }, { expiry_date: '错误时间' }, { status: 'unknown' }]) {
      creemRule = { ...original, ...change }
      await expect(readProviderDiscount('creem', { code: 'AIGC10' })).rejects.toMatchObject({ code: 'DISCOUNT_UNAVAILABLE' })
    }
    creemRule = { ...original, percentage: '10' }
    await expect(readProviderDiscount('creem', { code: 'AIGC10' })).rejects.toMatchObject({ code: 'DISCOUNT_UNSUPPORTED' })
  })
  it('区别不存在、权限缺失和平台异常，不泄漏响应内容', async () => {
    for (const [status, code] of [[404, 'DISCOUNT_INVALID'], [403, 'DISCOUNT_UNCONFIGURED'], [500, 'DISCOUNT_UNAVAILABLE']] as const) {
      fetchMock.mockResolvedValue(new Response('密钥或客户信息', { status }))
      await expect(readProviderDiscount('creem', { code: 'AIGC10' })).rejects.toMatchObject({ code })
      mocks.discount.mockRejectedValue({ status, message: '密钥或客户信息' })
      await expect(readProviderDiscount('dodo', { code: 'AIGC10' })).rejects.toMatchObject({ code })
    }
  })
  it('金额使用美分且只接受明确的百分比取整，不接受任意少付或零元', () => {
    expect(discountPayableAmount(299, 1000)).toBe(269)
    expect(matchesDiscountPayment(299, 1000, 269)).toBe(true); expect(matchesDiscountPayment(299, 1000, 270)).toBe(true)
    for (const paid of [268, 271, 0, 269.5]) expect(matchesDiscountPayment(299, 1000, paid)).toBe(false)
  })
})

describe('折扣结账与最终收据', () => {
  it('分别传单码，Dodo 仍关闭结账页自行叠加折扣', async () => {
    mocks.create.mockResolvedValue({ session_id: 'cs_dodo', checkout_url: 'https://checkout.dodopayments.com/test' })
    await createPaymentCheckout({ ...order, provider: 'dodo', quoted_discount: quoted }, 'buyer@example.com', 'https://aigc.example/')
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ discount_codes: ['AIGC10'], feature_flags: { allow_currency_selection: false, allow_discount_code: false } }))
    checkout.checkout_url = 'https://checkout.creem.io/test'
    await createPaymentCheckout({ ...order, quoted_discount: quoted }, 'buyer@example.com', 'https://aigc.example/')
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1].body).discount_code).toBe('AIGC10')
  })
  it('Creem 允许付款页添加优惠，并按最终实付保存优惠快照', async () => {
    expect(await readPaymentReceipt(order)).toMatchObject({ paidAmount: 269, discount: quoted })
    expect(fetchMock.mock.calls.map(call => call[0])).toContain('https://test-api.creem.io/v1/discounts?discount_id=dis_aigc')
  })
  it('Creem 允许更换或移除优惠；报价保留，最终实付独立', async () => {
    const prior = { ...quoted, id: 'dis_previous', code: 'AIGC20', percentBps: 2000, discountAmount: 60, payableAmount: 239 }
    expect(await readPaymentReceipt({ ...order, quoted_discount: prior })).toMatchObject({ paidAmount: 269, discount: quoted })
    checkout.discount = null
    checkout.order = { ...(checkout.order as object), discount: null, discount_amount: 0, amount_paid: 299, amount_due: 299 }
    transaction.amount_paid = 299; transaction.discount_amount = 0
    expect(await readPaymentReceipt({ ...order, quoted_discount: quoted })).toMatchObject({ paidAmount: 299, discount: null })
  })
  it('有冻结快照的券后来过期或删除不影响到账与退款，不重新验证当前可用次数', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('discounts')) throw new Error('不应重查历史券的可用性')
      return Response.json(url.includes('transactions') ? transaction : checkout)
    })
    transaction.status = 'partialRefund'; transaction.refunded_amount = 100
    expect(await readPaymentReceipt({ ...order, quoted_discount: quoted })).toMatchObject({ paidAmount: 269, refundedAmount: 100, discount: quoted })
  })
  it('拒绝缺少优惠证据、不同优惠编号、百分比或金额矛盾', async () => {
    const original = checkout, originalTransaction = { ...transaction }
    for (const change of [{ amount_paid: 268 }, { amount_paid: '269' }, { discount_amount: 29 }]) {
      transaction = { ...originalTransaction, ...change }
      await expect(readPaymentReceipt({ ...order, quoted_discount: quoted })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    }
    transaction = originalTransaction
    checkout = { ...original, discount: { id: 'other' } }
    await expect(readPaymentReceipt(order)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    checkout = { ...original, discount: { id: 'dis_aigc', amount: 20 } }
    await expect(readPaymentReceipt({ ...order, quoted_discount: quoted })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
  })
  it('Dodo 校验实际单码，拒绝额外折扣、遗漏代码和不符金额', async () => {
    const dodoOrder = { ...order, provider: 'dodo' as const, quoted_discount: quoted }
    mocks.checkout.mockResolvedValue({ payment_id: 'pay_dodo' })
    const payment = { payment_id: 'pay_dodo', checkout_session_id: order.checkout_id, metadata, currency: 'USD', status: 'succeeded',
      total_amount: 269, product_cart: [{ product_id: order.product_id, quantity: 1 }], refunds: [], disputes: [],
      discounts: [{ discount_id: 'dis_aigc', code: 'AIGC10', type: 'percentage', amount: 1000 }] }
    mocks.payment.mockResolvedValue(payment)
    expect(await readPaymentReceipt(dodoOrder)).toMatchObject({ paidAmount: 269, discount: quoted })
    for (const change of [{ total_amount: 268 }, { discounts: [] }, { discounts: [...payment.discounts, ...payment.discounts] }]) {
      mocks.payment.mockResolvedValue({ ...payment, ...change })
      await expect(readPaymentReceipt(dodoOrder)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    }
  })
})
