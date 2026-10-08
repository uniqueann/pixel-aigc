import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configuredProviders, createPaymentCheckout, readCreemReversal, readPaymentReceipt, validateProduct, type PaymentOrderSnapshot } from './providers'

const order: PaymentOrderSnapshot = {
  id: '00000000-0000-4000-8000-000000000411', user_id: '00000000-0000-4000-8000-000000000412',
  provider: 'creem', provider_mode: 'test', scope: 'preview', product_id: 'prod_aigc',
  amount: 299, currency: 'USD', credits: 100, checkout_id: 'ch_aigc',
}
const metadata = { productScope: 'aigc', orderId: order.id, userId: order.user_id, runtimeScope: order.scope, paymentMode: order.provider_mode }
const fetchMock = vi.fn()
let product: Record<string, unknown>
let checkout: Record<string, unknown>
let transaction: Record<string, unknown>
beforeEach(() => {
  vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview'); vi.stubEnv('AIGC_CREDIT_CURRENCY', 'USD')
  vi.stubEnv('AIGC_PAYMENTS_ENABLED', 'true'); vi.stubEnv('AIGC_CREEM_ENABLED', 'true')
  for (const provider of ['CREEM', 'DODO']) {
    vi.stubEnv(`AIGC_${provider}_TEST_API_KEY`, 'test_key')
    vi.stubEnv(`AIGC_${provider}_TEST_WEBHOOK_SECRET`, 'test_secret')
    vi.stubEnv(`AIGC_${provider}_TEST_STARTER_PRODUCT_ID`, order.product_id)
    vi.stubEnv(`AIGC_${provider}_LIVE_API_KEY`, '')
    vi.stubEnv(`AIGC_${provider}_LIVE_WEBHOOK_SECRET`, '')
  }
  product = { id: order.product_id, price: 299, currency: 'USD', billing_type: 'onetime', tax_mode: 'inclusive' }
  checkout = {
    id: order.checkout_id, request_id: order.id, status: 'completed', metadata, units: 1, product,
    order: { id: 'ord_aigc', product: order.product_id, currency: 'USD', amount: 299, amount_paid: 299, type: 'onetime', status: 'paid', transaction: 'tran_aigc' },
    checkout_url: 'https://test-checkout.creem.io/aigc',
  }
  transaction = { id: 'tran_aigc', order: 'ord_aigc', currency: 'USD', amount_paid: 299, type: 'payment', status: 'paid', mode: 'test', refunded_amount: 0 }
  fetchMock.mockReset().mockImplementation(async (input: string) => {
    const url = new URL(input)
    if (url.pathname === '/v1/products') return Response.json(product)
    if (url.pathname === '/v1/checkouts') return Response.json(checkout)
    if (url.pathname === '/v1/transactions') return Response.json(transaction)
    throw new Error('测试中出现未知的支付请求')
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Creem 下单与环境隔离', () => {
  it('双通道优先返回 Dodo，Creem 独立开关默认关闭且不影响 Dodo', () => {
    expect(configuredProviders('starter')).toEqual(['dodo', 'creem'])
    vi.stubEnv('AIGC_CREEM_ENABLED', '')
    expect(configuredProviders('starter')).toEqual(['dodo'])
    vi.stubEnv('AIGC_PAYMENTS_ENABLED', 'false')
    expect(configuredProviders('starter')).toEqual([])
  })
  it('缺少当前环境密钥、签名密钥或商品时不开放 Creem，也不回退到 LIVE', () => {
    vi.stubEnv('AIGC_CREEM_LIVE_API_KEY', 'live_key')
    for (const key of ['API_KEY', 'WEBHOOK_SECRET', 'STARTER_PRODUCT_ID']) {
      const name = `AIGC_CREEM_TEST_${key}`, original = process.env[name]!
      vi.stubEnv(name, '')
      expect(configuredProviders('starter')).toEqual(['dodo'])
      vi.stubEnv(name, original)
    }
  })
  it('只接受匹配价格、美元、含税且一次性的商品', async () => {
    await expect(validateProduct('creem', order.product_id, 299, 'USD')).resolves.toBeUndefined()
    const original = product
    for (const changed of [{ id: 'prod_edm' }, { price: 199 }, { currency: 'EUR' }, { billing_type: 'recurring' }, { tax_mode: 'exclusive' }]) {
      product = { ...original, ...changed }
      await expect(validateProduct('creem', order.product_id, 299, 'USD')).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    }
  })
  it('使用测试 API 创建一件商品的 Checkout，并绑定账号、订单和返回地址', async () => {
    const returnUrl = `https://aigc.example/?creditOrder=${order.id}`
    await expect(createPaymentCheckout(order, 'buyer@example.com', returnUrl)).resolves.toEqual({ id: order.checkout_id, url: checkout.checkout_url })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('https://test-api.creem.io/v1/checkouts')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ product_id: order.product_id, units: 1, request_id: order.id, customer: { email: 'buyer@example.com' }, success_url: returnUrl, metadata })
    expect(options.signal).toBeInstanceOf(AbortSignal)
  })
  it('Production 仅使用 LIVE API，测试订单不能由生产查询', async () => {
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'production'); vi.stubEnv('AIGC_CREEM_LIVE_API_KEY', 'live_key')
    await createPaymentCheckout({ ...order, scope: 'production', provider_mode: 'live' }, 'buyer@example.com', 'https://aigc.example/')
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.creem.io/v1/checkouts')
    await expect(readPaymentReceipt(order)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
  })
})

describe('Creem 实付与累计退款收据', () => {
  it.each(['object', 'id'])('兼容商品以 %s 返回，实付和退款来自重新查询交易', async shape => {
    if (shape === 'id') checkout.product = order.product_id
    const receipt = await readPaymentReceipt(order)
    expect(receipt).toMatchObject({ paymentId: 'ord_aigc', paidAmount: 299, refundedAmount: 0, disputed: false })
    expect(fetchMock.mock.calls.map(call => call[0])).toContain('https://test-api.creem.io/v1/transactions?transaction_id=tran_aigc')
    if (shape === 'id') expect(fetchMock.mock.calls.map(call => call[0])).toContain('https://test-api.creem.io/v1/products?product_id=prod_aigc')
  })
  it('商品后续改价不改写旧订单，以旧订单实付快照结算', async () => {
    product.price = 399
    await expect(readPaymentReceipt(order)).resolves.toMatchObject({ amount: 299, paidAmount: 299 })
  })
  it('拒绝错账号、项目、环境、商品、数量、改价、折扣和订阅', async () => {
    const original = checkout
    for (const changed of [
      { metadata: { ...metadata, productScope: 'edm' } }, { metadata: { ...metadata, userId: 'other' } },
      { metadata: { ...metadata, runtimeScope: 'production' } }, { metadata: { ...metadata, paymentMode: 'live' } },
      { id: 'ch_other' }, { request_id: 'other' }, { product: 'prod_other' }, { units: 2 }, { custom_price: 299 },
      { discount: { id: 'dis_test' } }, { subscription: 'sub_edm' },
      { order: { ...original.order as object, amount: 199 } }, { order: { ...original.order as object, type: 'recurring' } },
      { order: { ...original.order as object, discount_amount: 10 } },
    ]) {
      checkout = { ...original, ...changed }
      await expect(readPaymentReceipt(order)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    }
  })
  it('交易实付与套餐价不同、缺失、错币种或错订单均不能到账', async () => {
    const original = transaction
    for (const changed of [{ amount_paid: 199 }, { amount_paid: 299.5 }, { currency: 'EUR' }, { order: 'ord_edm' }, { id: 'tran_other' }, { type: 'invoice' }, { subscription: 'sub_edm' }, { discount_amount: 1 }, { mode: 'prod' }]) {
      transaction = { ...original, ...changed }
      await expect(readPaymentReceipt(order)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    }
    transaction = { ...original, amount_paid: null }
    await expect(readPaymentReceipt(order)).rejects.toMatchObject({ status: 503, code: 'PAYMENT_CONFIRMATION_PENDING' })
  })
  it('未完成结账或付款不发积分', async () => {
    checkout.status = 'pending'
    await expect(readPaymentReceipt(order)).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    checkout.status = 'completed'; transaction.status = 'pending'
    await expect(readPaymentReceipt(order)).resolves.toBeNull()
  })
  it('返回累计部分退款和争议状态，非法或缺失退款总额不结算', async () => {
    transaction.status = 'partialRefund'; transaction.refunded_amount = 120
    await expect(readPaymentReceipt(order)).resolves.toMatchObject({ refundedAmount: 120, disputed: false })
    transaction.status = 'chargedBack'; transaction.refunded_amount = 299
    await expect(readPaymentReceipt(order)).resolves.toMatchObject({ refundedAmount: 299, disputed: true })
    transaction.status = 'refunded'; transaction.refunded_amount = null
    await expect(readPaymentReceipt(order)).rejects.toMatchObject({ code: 'PAYMENT_CONFIRMATION_PENDING' })
    transaction.refunded_amount = 300
    await expect(readPaymentReceipt(order)).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
  })
  it('退款事件没有累计金额时仍使用查询总额；未反映最新退款时要求重试', async () => {
    const data = { order: 'ord_aigc', checkout: { id: order.checkout_id }, transaction: { id: 'tran_aigc' }, refund_amount: 40, refund_currency: 'USD' }
    transaction.status = 'partialRefund'; transaction.refunded_amount = 120
    await expect(readCreemReversal({ ...order, payment_id: 'ord_aigc' }, 'refund.created', data)).resolves.toMatchObject({ refundedAmount: 120 })
    transaction.refunded_amount = 0
    await expect(readCreemReversal({ ...order, payment_id: 'ord_aigc' }, 'refund.created', data)).rejects.toMatchObject({ status: 503 })
    transaction.refunded_amount = 80
    await expect(readCreemReversal({ ...order, payment_id: 'ord_aigc' }, 'refund.created', { ...data, transaction: { id: 'tran_aigc', refunded_amount: 120 } })).rejects.toMatchObject({ status: 503 })
  })
  it('退款不能关联其他付款、结账、交易或币种', async () => {
    transaction.status = 'refunded'; transaction.refunded_amount = 299
    const original = { order: 'ord_aigc', checkout: { id: order.checkout_id }, transaction: { id: 'tran_aigc' }, refund_amount: 299, refund_currency: 'USD' }
    for (const changed of [{ order: 'ord_other' }, { checkout: 'ch_other' }, { transaction: { id: 'tran_other' } }, { refund_currency: 'EUR' }]) {
      await expect(readCreemReversal({ ...order, payment_id: 'ord_aigc' }, 'refund.created', { ...original, ...changed })).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    }
  })
  it('关闭新下单入口后仍能查已有付款和退款', async () => {
    vi.stubEnv('AIGC_CREEM_ENABLED', 'false'); vi.stubEnv('AIGC_PAYMENTS_ENABLED', 'false')
    expect(configuredProviders()).toEqual([])
    await expect(readPaymentReceipt(order)).resolves.toMatchObject({ paidAmount: 299 })
    transaction.status = 'refunded'; transaction.refunded_amount = 299
    await expect(readCreemReversal({ ...order, payment_id: 'ord_aigc' }, 'refund.created', { order: 'ord_aigc', refund_currency: 'USD', refund_amount: 299 })).resolves.toMatchObject({ refundedAmount: 299 })
  })
  it('部分争议只撤销已核验的争议金额，不默认当成整包退款', async () => {
    transaction.status = 'chargedBack'; transaction.refunded_amount = null
    await expect(readCreemReversal({ ...order, payment_id: 'ord_aigc' }, 'dispute.created', {
      order: 'ord_aigc', transaction: { id: 'tran_aigc' }, amount: 80, currency: 'USD',
    })).resolves.toMatchObject({ disputed: true, reversalAmount: 80 })
  })
})

describe('Creem 请求错误', () => {
  it('网络异常、超时、错误状态和无效 JSON 都不暴露原始错误', async () => {
    for (const failure of [
      () => Promise.reject(new Error('test_key buyer@example.com')),
      () => Promise.reject(new DOMException('test_key', 'TimeoutError')),
      () => Promise.resolve(new Response('test_key', { status: 500 })),
      () => Promise.resolve(new Response('bad json test_key')),
      () => Promise.resolve(Response.json([])),
    ]) {
      fetchMock.mockImplementation(failure)
      await expect(validateProduct('creem', order.product_id, 299, 'USD')).rejects.toMatchObject({ status: 502, code: 'PAYMENT_PROVIDER_ERROR', message: '支付通道暂时不可用，请稍后查询订单' })
    }
  })
})
