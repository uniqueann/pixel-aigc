import { createHmac, timingSafeEqual } from 'node:crypto'
import DodoPayments from 'dodopayments'
import { CREDIT_PACKS, type CreditCurrency, type CreditPackId, type PaymentProvider } from '../../shared/billing.js'
import { runtimeScope } from '../db.js'
import { HttpError } from '../errors.js'

export type PaymentMode = 'test' | 'live'
export function paymentMode(): PaymentMode { return runtimeScope() === 'production' ? 'live' : 'test' }
export function creditCurrency(): CreditCurrency {
  const value = process.env.AIGC_CREDIT_CURRENCY ?? 'CNY'
  if (value !== 'USD' && value !== 'CNY') throw new HttpError(503, '充值币种配置无效', 'PAYMENT_UNCONFIGURED')
  return value
}
function setting(provider: PaymentProvider, name: string) {
  return process.env[`AIGC_${provider.toUpperCase()}_${paymentMode().toUpperCase()}_${name}`]?.trim()
}
export function productId(provider: PaymentProvider, pack: CreditPackId) {
  return setting(provider, `${pack.toUpperCase()}_PRODUCT_ID`)
}
export function configuredProviders(pack?: CreditPackId): PaymentProvider[] {
  if (process.env.AIGC_PAYMENTS_ENABLED !== 'true') return []
  return (['creem', 'dodo'] as const).filter(provider => (provider !== 'creem' || creditCurrency() === 'USD')
    && Boolean(setting(provider, 'API_KEY') && setting(provider, 'WEBHOOK_SECRET'))
    && (pack ? Boolean(productId(provider, pack)) : CREDIT_PACKS.some(item => productId(provider, item.id))))
}
function dodo() {
  const bearerToken = setting('dodo', 'API_KEY'), webhookKey = setting('dodo', 'WEBHOOK_SECRET')
  if (!bearerToken || !webhookKey) throw new HttpError(503, '支付通道尚未配置', 'PAYMENT_UNCONFIGURED')
  return new DodoPayments({ bearerToken, webhookKey, environment: paymentMode() === 'live' ? 'live_mode' : 'test_mode', maxRetries: 0, timeout: 20_000 })
}
async function dodoCall<T>(action:(client:DodoPayments)=>Promise<T>) {
  try {return await action(dodo())}
  catch(error) {
    if(error instanceof HttpError) throw error
    // 支付 SDK 的原始错误不进入用户响应或日志，避免携带请求头及客户数据。
    throw new HttpError(502,'支付通道暂时不可用，请稍后查询订单','PAYMENT_PROVIDER_ERROR')
  }
}
async function creem(path: string, body?: object): Promise<Record<string, unknown>> {
  const key = setting('creem', 'API_KEY')
  if (!key) throw new HttpError(503, '支付通道尚未配置', 'PAYMENT_UNCONFIGURED')
  const response = await fetch(`${paymentMode() === 'live' ? 'https://api.creem.io' : 'https://test-api.creem.io'}/v1/${path}`, {
    method: body ? 'POST' : 'GET', headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw new HttpError(502, '支付通道暂时不可用，请稍后查询订单', 'PAYMENT_PROVIDER_ERROR')
  return record(await response.json())
}
export function record(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {}
}
function check(condition: unknown) {
  if (!condition) throw new HttpError(409, '支付商品或订单信息不一致，请联系支持', 'PAYMENT_MISMATCH')
}
export interface PaymentOrderSnapshot {
  id: string; user_id: string; scope: string; provider: PaymentProvider; provider_mode: PaymentMode;
  product_id: string; amount: number; currency: CreditCurrency; credits: number; checkout_id: string | null;
}
export interface PaymentReceipt {
  checkoutId: string; paymentId: string; productId: string; amount: number; currency: string;
  paidAmount: number; refundedAmount: number; disputed: boolean;
}
function checkMetadata(metadata: unknown, order: PaymentOrderSnapshot) {
  const meta = record(metadata)
  check(meta.productScope === 'aigc' && meta.orderId === order.id && meta.userId === order.user_id
    && meta.runtimeScope === order.scope && meta.paymentMode === order.provider_mode)
}
export async function validateProduct(provider: PaymentProvider, id: string, amount: number, currency: CreditCurrency) {
  if (provider === 'creem') {
    const p = await creem(`products?product_id=${encodeURIComponent(id)}`)
    check(p.id === id && p.price === amount && p.currency === currency && p.billing_type === 'onetime'
      && p.tax_mode === 'inclusive')
  } else {
    const p = await dodoCall(client=>client.products.retrieve(id)), price = p.price
    check(price.type === 'one_time_price' && price.currency === currency && price.price === amount
      && price.tax_inclusive === true && !price.pay_what_you_want && !price.purchasing_power_parity
      && !price.discount && !price.discount_bps)
  }
}
export async function createPaymentCheckout(order: PaymentOrderSnapshot, email: string, returnUrl: string) {
  const metadata = { productScope: 'aigc', orderId: order.id, userId: order.user_id, runtimeScope: order.scope, paymentMode: order.provider_mode }
  if (order.provider === 'creem') {
    const checkout = await creem('checkouts', { product_id: order.product_id, request_id: order.id, success_url: returnUrl, customer: { email }, metadata })
    check(typeof checkout.id === 'string' && typeof checkout.checkout_url === 'string')
    return { id: String(checkout.id), url: validateCheckoutUrl(String(checkout.checkout_url), 'creem') }
  }
  const checkout = await dodoCall(client=>client.checkoutSessions.create({
    product_cart: [{ product_id: order.product_id, quantity: 1 }], customer: { email }, return_url: returnUrl, metadata,
    billing_currency: order.currency, feature_flags: { allow_currency_selection: false, allow_discount_code: false },
  }))
  check(checkout.checkout_url)
  return { id: checkout.session_id, url: validateCheckoutUrl(checkout.checkout_url!, 'dodo') }
}
export function validateCheckoutUrl(value: string, provider: PaymentProvider) {
  let url: URL
  try { url = new URL(value) } catch { throw new HttpError(502, '支付地址无效', 'PAYMENT_PROVIDER_ERROR') }
  const domain = provider === 'creem' ? 'creem.io' : 'dodopayments.com'
  check(url.protocol === 'https:' && (url.hostname === domain || url.hostname.endsWith(`.${domain}`)))
  check(!url.username && !url.password)
  return url.toString()
}
export async function readPaymentReceipt(order: PaymentOrderSnapshot): Promise<PaymentReceipt | null> {
  check(order.provider_mode === paymentMode() && order.scope === runtimeScope())
  if (!order.checkout_id) return null
  if (order.provider === 'dodo') {
    const checkout = await dodoCall(client=>client.checkoutSessions.retrieve(order.checkout_id!))
    if (!checkout.payment_id) return null
    const p = await dodoCall(client=>client.payments.retrieve(checkout.payment_id!))
    checkMetadata(p.metadata, order)
    check(p.checkout_session_id === order.checkout_id && p.currency === order.currency && !p.subscription_id
      && p.product_cart?.length === 1 && p.product_cart[0].product_id === order.product_id && p.product_cart[0].quantity === 1)
    if (p.status !== 'succeeded') return null
    // 含税固定价商品禁用折扣及币种切换，必须与创建订单时的金额完全一致。
    check(p.total_amount === order.amount && !p.discount_id && !p.discounts?.length)
    const refundedAmount = p.refunds.filter(item => item.status === 'succeeded').reduce((sum, item) => {
      check(Number.isSafeInteger(item.amount) && Number(item.amount)>0 && item.currency === order.currency)
      return sum+Number(item.amount)
    },0)
    return { checkoutId: order.checkout_id, paymentId: p.payment_id, productId: order.product_id,
      amount: order.amount, currency: p.currency, paidAmount: p.total_amount, refundedAmount, disputed: p.disputes.length > 0 }
  }
  const checkout = await creem(`checkouts?checkout_id=${encodeURIComponent(order.checkout_id)}`)
  checkMetadata(checkout.metadata, order)
  if (checkout.status !== 'completed') return null
  const p = record(checkout.product), paid = record(checkout.order)
  check(checkout.id === order.checkout_id && checkout.request_id === order.id && p.id === order.product_id
    && p.price === order.amount && p.currency === order.currency && p.billing_type === 'onetime' && p.tax_mode === 'inclusive'
    && paid.product === order.product_id && paid.currency === order.currency && paid.amount === order.amount && !checkout.subscription)
  if (checkout.status !== 'completed' || paid.status !== 'paid') return null
  check(typeof paid.id === 'string')
  return { checkoutId: order.checkout_id, paymentId: String(paid.id), productId: order.product_id,
    amount: order.amount, currency: order.currency, paidAmount: order.amount, refundedAmount: 0, disputed: false }
}
export function verifyPaymentEvent(provider: PaymentProvider, body: string, headers: Record<string, string | string[] | undefined>) {
  const secret = setting(provider, 'WEBHOOK_SECRET')
  if (!secret) throw new HttpError(503, '支付回调尚未配置', 'PAYMENT_UNCONFIGURED')
  if (provider === 'dodo') {
    try {
      return record(dodo().webhooks.unwrap(body, { headers: {
        'webhook-id': String(headers['webhook-id'] ?? ''), 'webhook-timestamp': String(headers['webhook-timestamp'] ?? ''),
        'webhook-signature': String(headers['webhook-signature'] ?? ''),
      } }))
    } catch { throw new HttpError(401, '支付回调签名无效', 'INVALID_WEBHOOK_SIGNATURE') }
  }
  const supplied = headers['creem-signature'], expected = createHmac('sha256', secret).update(body).digest()
  if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/i.test(supplied)
    || !timingSafeEqual(Buffer.from(supplied, 'hex'), expected)) throw new HttpError(401, '支付回调签名无效', 'INVALID_WEBHOOK_SIGNATURE')
  return record(JSON.parse(body))
}
