import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sql: vi.fn(), product: vi.fn(), checkout: vi.fn(), create: vi.fn(), payment: vi.fn(), fetch: vi.fn() }))
vi.mock('dodopayments', async importOriginal => {
  const actual = await importOriginal<typeof import('dodopayments')>()
  return { default: class {
    constructor(options: ConstructorParameters<typeof actual.default>[0]) { this.webhooks = new actual.default(options).webhooks }
    webhooks: InstanceType<typeof actual.default>['webhooks']
    products = { retrieve: mocks.product }
    checkoutSessions = { retrieve: mocks.checkout, create: mocks.create }
    payments = { retrieve: mocks.payment }
  } }
})
vi.mock('../db.js', () => ({
  database: () => ({ begin: async (fn: (sql: typeof mocks.sql) => Promise<unknown>) => fn(mocks.sql) }),
  runtimeScope: () => 'preview',
}))
import { handlePaymentWebhook, reconcileCreditOrder } from './service.js'
import type { StoredCreditOrder } from './service.js'

const orderId = '00000000-0000-4000-8000-000000000211'
const userId = '00000000-0000-4000-8000-000000000212'
const creemPaymentId = 'ord_4aDwWXjMLpes4Kj4XqNnUA'
const creemCheckoutId = 'ch_4l0N34kxo16AhRKUHFUuXr'
function storedOrder(overrides: Partial<StoredCreditOrder> = {}): StoredCreditOrder {
  return {
    id: orderId, user_id: userId, scope: 'preview', provider: 'creem', provider_mode: 'test',
    product_id: 'prod_aigc_starter', amount: 199, currency: 'USD', credits: 100, checkout_id: creemCheckoutId,
    pack_id: 'starter', status: 'paid', checkout_url: 'https://checkout.creem.io/test', refund_requested: false,
    created_at: '2026-10-04T00:00:00.000Z', payment_id: creemPaymentId, refunded_amount: 0, ...overrides,
  }
}
let current = storedOrder()
let creemTransaction: Record<string, unknown>
function reversalArgs() {
  return mocks.sql.mock.calls
    .filter(([parts]) => Array.from(parts as TemplateStringsArray).join('').includes('reverse_credit_order'))
    .map(call => call.slice(1))
}
function signCreem(body: string) {
  return { 'creem-signature': createHmac('sha256', 'test_secret').update(body).digest('hex') }
}
// 结构对齐 https://docs.creem.io/code/webhooks 的 refund.created / dispute.created。
// 回调只提供定位和核验线索，累计退款总额来自重新查询的交易。
function creemRefund(overrides: { id: string; amount: number; cumulative?: number; status?: string; orderId?: string; checkoutId?: string }) {
  return {
    id: overrides.id,
    eventType: 'refund.created',
    created_at: 1728734351631,
    object: {
      id: `ref_${overrides.id}`,
      object: 'refund',
      status: overrides.status ?? 'succeeded',
      refund_amount: overrides.amount,
      refund_currency: 'USD',
      reason: 'requested_by_customer',
      transaction: {
        id: 'tran_aigc',
        object: 'transaction',
        amount: 199,
        amount_paid: 199,
        currency: 'USD',
        type: 'payment',
        status: overrides.cumulative != null && overrides.cumulative < 199 ? 'partialRefund' : 'refunded',
        ...(overrides.cumulative == null ? {} : { refunded_amount: overrides.cumulative }),
      },
      checkout: { id: overrides.checkoutId ?? creemCheckoutId, object: 'checkout', status: 'completed' },
      order: {
        id: overrides.orderId ?? creemPaymentId,
        object: 'order',
        amount: 199,
        currency: 'USD',
        status: 'paid',
        type: 'onetime',
      },
    },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview')
  vi.stubEnv('AIGC_CREDIT_CURRENCY', 'USD')
  vi.stubEnv('AIGC_PAYMENTS_ENABLED', 'true')
  vi.stubEnv('AIGC_CREEM_TEST_API_KEY', 'test_key')
  vi.stubEnv('AIGC_CREEM_TEST_WEBHOOK_SECRET', 'test_secret')
  vi.stubEnv('AIGC_DODO_TEST_API_KEY', 'test_key')
  vi.stubEnv('AIGC_DODO_TEST_WEBHOOK_SECRET', 'test_secret')
  current = storedOrder()
  creemTransaction = { id: 'tran_aigc', mode: 'test', order: creemPaymentId, currency: 'USD',
    amount_paid: 199, status: 'paid', type: 'payment', refunded_amount: 0 }
  mocks.fetch.mockImplementation(async (input: string) => {
    const url = new URL(input)
    if (url.pathname === '/v1/transactions') return Response.json(creemTransaction)
    if (url.pathname === '/v1/checkouts') return Response.json({
      id: creemCheckoutId, object: 'checkout', request_id: orderId, status: 'completed', units: 1,
      metadata: { productScope: 'aigc', orderId, userId, runtimeScope: 'preview', paymentMode: 'test' },
      product: { id: 'prod_aigc_starter', currency: 'USD', price: 199, billing_type: 'onetime', tax_mode: 'inclusive' },
      order: { id: creemPaymentId, amount: 199, currency: 'USD', product: 'prod_aigc_starter', type: 'onetime', status: 'paid', transaction: 'tran_aigc' },
    })
    throw new Error('测试中出现未知的支付请求')
  })
  vi.stubGlobal('fetch', mocks.fetch)
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...args: unknown[]) => {
    const query = Array.from(parts).join(' ')
    if (query.includes('where id=')) return args[0] === current.id ? [current] : []
    if (query.includes('payment_id=')) return args[0] === current.payment_id ? [current] : []
    if (query.includes('checkout_id=')) return args[0] === current.checkout_id ? [current] : []
    return []
  })
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Creem 退款与争议回调', () => {
  it('部分退款按订单号和结账号找到订单，并用累计退款金额收回积分', async () => {
    const pending = JSON.stringify(creemRefund({ id: 'evt_pending', amount: 80, status: 'pending' }))
    await expect(handlePaymentWebhook('creem', pending, signCreem(pending))).resolves.toEqual({ received: true, ignored: true })
    expect(reversalArgs()).toEqual([])
    creemTransaction.status = 'partialRefund'; creemTransaction.refunded_amount = 80
    const first = JSON.stringify(creemRefund({ id: 'evt_partial', amount: 80 }))
    await handlePaymentWebhook('creem', first, signCreem(first))
    creemTransaction.refunded_amount = 120
    const second = JSON.stringify(creemRefund({ id: 'evt_partial_more', amount: 40, cumulative: 120 }))
    await handlePaymentWebhook('creem', second, signCreem(second))
    expect(reversalArgs()).toEqual([
      [orderId, 80, 'USD', 'evt_partial', 'refund.created'],
      [orderId, 120, 'USD', 'evt_partial_more', 'refund.created'],
    ])
  })
  it('全额退款核对退款对象，使用重新查询的累计金额和事件编号', async () => {
    creemTransaction.status = 'refunded'; creemTransaction.refunded_amount = 199
    const body = JSON.stringify({
      ...creemRefund({ id: 'evt_61eTsJHUgInFw2BQKhTiPV', amount: 199, cumulative: 199 }),
      object: {
        ...creemRefund({ id: 'evt_61eTsJHUgInFw2BQKhTiPV', amount: 199, cumulative: 199 }).object,
        transaction: {
          id: 'tran_aigc',
          object: 'transaction',
          amount: 199,
          amount_paid: 199,
          currency: 'USD',
          type: 'payment',
          status: 'refunded',
          refunded_amount: 199,
          order: creemPaymentId,
        },
      },
    })
    await handlePaymentWebhook('creem', body, signCreem(body))
    expect(reversalArgs()).toEqual([[orderId, 199, 'USD', 'evt_61eTsJHUgInFw2BQKhTiPV', 'refund.created']])
  })
  it('争议重新查询并确认交易后收回积分，不依赖回调的 transaction.order', async () => {
    creemTransaction.status = 'chargedBack'; creemTransaction.refunded_amount = 199
    const body = JSON.stringify({
      id: 'evt_6mfLDL7P0NYwYQqCrICvDH',
      eventType: 'dispute.created',
      created_at: 1750941264812,
      object: {
        id: 'disp_6vSsOdTANP5PhOzuDlUuXE',
        object: 'dispute',
        amount: 199,
        currency: 'USD',
        transaction: {
          id: 'tran_aigc',
          object: 'transaction',
          amount: 199,
          amount_paid: 199,
          currency: 'EUR',
          type: 'payment',
          status: 'chargeback',
        },
        checkout: { id: creemCheckoutId, object: 'checkout', status: 'completed' },
        order: { object: 'order', id: creemPaymentId, amount: 199, currency: 'USD', status: 'paid', type: 'onetime' },
      },
    })
    await handlePaymentWebhook('creem', body, signCreem(body))
    expect(reversalArgs()).toEqual([[orderId, 199, 'USD', 'evt_6mfLDL7P0NYwYQqCrICvDH', 'dispute.created']])
  })
  it('结账号能对上但订单号不一致时拒绝收回积分', async () => {
    const body = JSON.stringify(creemRefund({ id: 'evt_mismatch', amount: 199, orderId: 'ord_other' }))
    await expect(handlePaymentWebhook('creem', body, signCreem(body))).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' })
    expect(reversalArgs()).toEqual([])
  })
  it('回调缺少累计金额时，连续和乱序事件始终使用交易最新总额', async () => {
    creemTransaction.status = 'partialRefund'; creemTransaction.refunded_amount = 120
    const latest = JSON.stringify(creemRefund({ id: 'evt_latest', amount: 40 }))
    const older = JSON.stringify(creemRefund({ id: 'evt_older', amount: 80, cumulative: 80 }))
    await handlePaymentWebhook('creem', latest, signCreem(latest))
    await handlePaymentWebhook('creem', older, signCreem(older))
    await handlePaymentWebhook('creem', latest, signCreem(latest))
    expect(reversalArgs().map(args => args[1])).toEqual([120, 120, 120])
  })
  it('平台查询尚未反映退款时不写撤销或已处理事件，保留回调重试', async () => {
    const body = JSON.stringify(creemRefund({ id: 'evt_unconfirmed', amount: 80, cumulative: 80 }))
    await expect(handlePaymentWebhook('creem', body, signCreem(body))).rejects.toMatchObject({ status: 503, code: 'PAYMENT_CONFIRMATION_PENDING' })
    expect(reversalArgs()).toEqual([])
  })
  it('退款先于到账时只进入撤销核对，不调用积分发放', async () => {
    current = storedOrder({ status: 'pending', payment_id: null })
    creemTransaction.status = 'refunded'; creemTransaction.refunded_amount = 199
    const body = JSON.stringify(creemRefund({ id: 'evt_before_paid', amount: 199, cumulative: 199 }))
    await handlePaymentWebhook('creem', body, signCreem(body))
    await reconcileCreditOrder(current, 'evt_later_paid', 'checkout.completed')
    expect(reversalArgs()).toHaveLength(2)
    expect(mocks.sql.mock.calls.some(([parts]) => Array.from(parts as TemplateStringsArray).join('').includes('complete_credit_order'))).toBe(false)
  })
  it('只有 transaction.order 的退款也能定位已付款订单', async () => {
    creemTransaction.status = 'partialRefund'; creemTransaction.refunded_amount = 80
    const body = JSON.stringify({ id: 'evt_transaction_order', eventType: 'refund.created', object: {
      status: 'succeeded', refund_amount: 80, refund_currency: 'USD', transaction: { id: 'tran_aigc', order: creemPaymentId },
    } })
    await handlePaymentWebhook('creem', body, signCreem(body))
    expect(reversalArgs()).toEqual([[orderId, 80, 'USD', 'evt_transaction_order', 'refund.created']])
  })
})

describe('Creem 到账与项目隔离', () => {
  it('到账回调和补偿查询统一调用订单幂等结算，关闭入口不影响既有订单', async () => {
    current = storedOrder({ status: 'pending', payment_id: null })
    vi.stubEnv('AIGC_PAYMENTS_ENABLED', 'false'); vi.stubEnv('AIGC_CREEM_ENABLED', 'false')
    const body = JSON.stringify({ id: 'evt_checkout', eventType: 'checkout.completed', object: {
      id: creemCheckoutId, object: 'checkout', metadata: { productScope: 'aigc', orderId, userId, runtimeScope: 'preview', paymentMode: 'test' },
    } })
    await handlePaymentWebhook('creem', body, signCreem(body))
    await reconcileCreditOrder(current, 'reconcile_test')
    const calls = mocks.sql.mock.calls.filter(([parts]) => Array.from(parts as TemplateStringsArray).join('').includes('complete_credit_order'))
    expect(calls).toHaveLength(2)
    expect(calls.map(call => call.slice(1, 8))).toEqual(Array(2).fill([orderId, creemCheckoutId, creemPaymentId, 'prod_aigc_starter', 199, 'USD', 199]))
  })
  it('EDM 事件即使带有相同付款编号也不查询或写入 AIGC', async () => {
    const body = JSON.stringify({ ...creemRefund({ id: 'evt_edm', amount: 199 }), object: {
      ...creemRefund({ id: 'evt_edm', amount: 199 }).object, metadata: { productScope: 'edm', orderId },
    } })
    await expect(handlePaymentWebhook('creem', body, signCreem(body))).resolves.toEqual({ received: true, ignored: true })
    expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('其他环境的 AIGC 事件不能触发当前环境结算', async () => {
    const body = JSON.stringify({ id: 'evt_other_scope', eventType: 'checkout.completed', object: {
      id: creemCheckoutId, object: 'checkout', metadata: { productScope: 'aigc', orderId, userId, runtimeScope: 'production', paymentMode: 'live' },
    } })
    await expect(handlePaymentWebhook('creem', body, signCreem(body))).resolves.toEqual({ received: true, ignored: true })
    expect(mocks.sql).not.toHaveBeenCalled(); expect(mocks.fetch).not.toHaveBeenCalled()
  })
  it('已完成回调先于查询确认时要求平台重试，不能当作已处理', async () => {
    creemTransaction.status = 'pending'
    const body = JSON.stringify({ id: 'evt_query_lag', eventType: 'checkout.completed', object: {
      id: creemCheckoutId, object: 'checkout', metadata: { productScope: 'aigc', orderId, userId, runtimeScope: 'preview', paymentMode: 'test' },
    } })
    await expect(handlePaymentWebhook('creem', body, signCreem(body))).rejects.toMatchObject({ status: 503, code: 'PAYMENT_CONFIRMATION_PENDING' })
    expect(mocks.sql.mock.calls.some(([parts]) => Array.from(parts as TemplateStringsArray).join('').includes('complete_credit_order'))).toBe(false)
  })
  it('补偿查询发现争议但缺少现金撤销总额时只冻结核对，不猜整包退款金额', async () => {
    creemTransaction.status = 'chargedBack'; creemTransaction.refunded_amount = null
    await reconcileCreditOrder(current, 'reconcile_dispute')
    expect(reversalArgs()).toEqual([[orderId, 0, 'USD', 'reconcile_dispute', 'dispute.created']])
    expect(mocks.sql.mock.calls.some(([parts]) => Array.from(parts as TemplateStringsArray).join('').includes('complete_credit_order'))).toBe(false)
  })
  it('已经部分退款后再遇到金额缺失的争议，保留累计金额以确保冻结核对', async () => {
    current = storedOrder({ refunded_amount: 80 })
    creemTransaction.status = 'chargedBack'; creemTransaction.refunded_amount = null
    await reconcileCreditOrder(current, 'reconcile_after_partial')
    expect(reversalArgs()).toEqual([[orderId, 80, 'USD', 'reconcile_after_partial', 'dispute.created']])
  })
})

describe('Dodo 退款与争议回调', () => {
  it('用 payment_id 找到订单，并按重新查询到的累计成功退款和争议收回积分', async () => {
    const key = randomBytes(32)
    vi.stubEnv('AIGC_DODO_TEST_WEBHOOK_SECRET', `whsec_${key.toString('base64')}`)
    current = storedOrder({ provider: 'dodo', checkout_id: 'ch_dodo', payment_id: 'pay_dodo' })
    const metadata = { productScope: 'aigc', orderId, userId, runtimeScope: 'preview', paymentMode: 'test' }
    mocks.checkout.mockResolvedValue({ payment_id: 'pay_dodo' })
    mocks.payment.mockResolvedValue({
      payment_id: 'pay_dodo', checkout_session_id: 'ch_dodo', metadata, currency: 'USD', total_amount: 199, status: 'succeeded',
      product_cart: [{ product_id: 'prod_aigc_starter', quantity: 1 }],
      refunds: [{ status: 'succeeded', amount: 40, currency: 'USD' }, { status: 'succeeded', amount: 40, currency: 'USD' }],
      disputes: [],
    })
    const refundBody = JSON.stringify({
      business_id: 'biz_test', type: 'refund.succeeded', timestamp: '2026-10-04T00:00:00.000Z',
      data: { payload_type: 'Refund', refund_id: 'ref_dodo', payment_id: 'pay_dodo', amount: 40, currency: 'USD', status: 'succeeded', is_partial: true },
    })
    const refundId = 'msg_refund'
    const refundTimestamp = String(Math.floor(Date.now() / 1000))
    const refundSignature = `v1,${createHmac('sha256', key).update(`${refundId}.${refundTimestamp}.${refundBody}`).digest('base64')}`
    await handlePaymentWebhook('dodo', refundBody, { 'webhook-id': refundId, 'webhook-timestamp': refundTimestamp, 'webhook-signature': refundSignature })
    expect(reversalArgs()).toEqual([[orderId, 80, 'USD', `${refundId}:reversal`, 'refund.succeeded']])
    mocks.payment.mockResolvedValue({
      payment_id: 'pay_dodo', checkout_session_id: 'ch_dodo', metadata, currency: 'USD', total_amount: 199, status: 'succeeded',
      product_cart: [{ product_id: 'prod_aigc_starter', quantity: 1 }],
      refunds: [], disputes: [{ dispute_id: 'disp_dodo', amount: 199, currency: 'USD' }],
    })
    const disputeBody = JSON.stringify({
      business_id: 'biz_test', type: 'dispute.opened', timestamp: '2026-10-04T00:00:00.000Z',
      data: { payload_type: 'Dispute', dispute_id: 'disp_dodo', payment_id: 'pay_dodo', amount: 199, currency: 'USD', dispute_status: 'dispute_opened' },
    })
    const disputeId = 'msg_dispute'
    const disputeTimestamp = String(Math.floor(Date.now() / 1000))
    const disputeSignature = `v1,${createHmac('sha256', key).update(`${disputeId}.${disputeTimestamp}.${disputeBody}`).digest('base64')}`
    await handlePaymentWebhook('dodo', disputeBody, { 'webhook-id': disputeId, 'webhook-timestamp': disputeTimestamp, 'webhook-signature': disputeSignature })
    expect(reversalArgs()[1]).toEqual([orderId, 199, 'USD', `${disputeId}:reversal`, 'dispute.created'])
  })
})
