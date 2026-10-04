import { createHmac, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ sql: vi.fn(), product: vi.fn(), checkout: vi.fn(), create: vi.fn(), payment: vi.fn() }))
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
import { handlePaymentWebhook } from './service.js'
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
    created_at: '2026-10-04T00:00:00.000Z', payment_id: creemPaymentId, ...overrides,
  }
}
let current = storedOrder()
function reversalArgs() {
  return mocks.sql.mock.calls
    .filter(([parts]) => Array.from(parts as TemplateStringsArray).join('').includes('reverse_credit_order'))
    .map(call => call.slice(1))
}
function signCreem(body: string) {
  return { 'creem-signature': createHmac('sha256', 'test_secret').update(body).digest('hex') }
}
// 结构对齐 https://docs.creem.io/code/webhooks 的 refund.created / dispute.created。
// 订单实体在 object.order，结账在 object.checkout；不依赖 transaction.order 或 transaction.refunded_amount。
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
        id: `tran_${overrides.id}`,
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
  mocks.sql.mockImplementation(async (parts: TemplateStringsArray, ...args: unknown[]) => {
    const query = Array.from(parts).join(' ')
    if (query.includes('where id=')) return args[0] === current.id ? [current] : []
    if (query.includes('payment_id=')) return args[0] === current.payment_id ? [current] : []
    if (query.includes('checkout_id=')) return args[0] === current.checkout_id ? [current] : []
    return []
  })
})
afterEach(() => { vi.unstubAllEnvs() })

describe('Creem 退款与争议回调', () => {
  it('部分退款按订单号和结账号找到订单，并用累计退款金额收回积分', async () => {
    const pending = JSON.stringify(creemRefund({ id: 'evt_pending', amount: 80, status: 'pending' }))
    await expect(handlePaymentWebhook('creem', pending, signCreem(pending))).resolves.toEqual({ received: true, ignored: true })
    expect(reversalArgs()).toEqual([])
    const first = JSON.stringify(creemRefund({ id: 'evt_partial', amount: 80 }))
    await handlePaymentWebhook('creem', first, signCreem(first))
    const second = JSON.stringify(creemRefund({ id: 'evt_partial_more', amount: 40, cumulative: 120 }))
    await handlePaymentWebhook('creem', second, signCreem(second))
    expect(reversalArgs()).toEqual([
      [orderId, 80, 'USD', 'evt_partial', 'refund.created'],
      [orderId, 120, 'USD', 'evt_partial_more', 'refund.created'],
    ])
  })
  it('全额退款使用退款对象上的金额、币种和事件编号', async () => {
    const body = JSON.stringify({
      ...creemRefund({ id: 'evt_61eTsJHUgInFw2BQKhTiPV', amount: 199, cumulative: 199 }),
      object: {
        ...creemRefund({ id: 'evt_61eTsJHUgInFw2BQKhTiPV', amount: 199, cumulative: 199 }).object,
        transaction: {
          id: 'tran_5yMaWzAl3jxuGJMCOrYWwk',
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
  it('争议按 object.amount 和 object.currency 收回积分，不依赖 transaction.order', async () => {
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
          id: 'tran_4Dk8CxWFdceRUQgMFhCCXX',
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
