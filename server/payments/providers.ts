import { createHmac, timingSafeEqual } from 'node:crypto'
import DodoPayments from 'dodopayments'
import { CREDIT_PACKS, type CreditCurrency, type CreditPackId, type PaymentProvider } from '../../shared/billing.js'
import { runtimeScope } from '../db.js'
import { HttpError } from '../errors.js'
import { discountPayableAmount, matchesDiscountPayment, normalizeCreditDiscountCode, type CreditDiscount } from '../../shared/credit-discounts.js'

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
  return (['dodo', 'creem'] as const).filter(provider => (provider !== 'creem'
    || (process.env.AIGC_CREEM_ENABLED === 'true' && creditCurrency() === 'USD'))
    && Boolean(setting(provider, 'API_KEY') && setting(provider, 'WEBHOOK_SECRET'))
    && (pack ? Boolean(productId(provider, pack)) : CREDIT_PACKS.some(item => productId(provider, item.id))))
}
function dodo() {
  const bearerToken = setting('dodo', 'API_KEY'), webhookKey = setting('dodo', 'WEBHOOK_SECRET')
  if (!bearerToken || !webhookKey) throw new HttpError(503, '支付通道尚未配置', 'PAYMENT_UNCONFIGURED')
  return new DodoPayments({ bearerToken, webhookKey, environment: paymentMode() === 'live' ? 'live_mode' : 'test_mode', maxRetries: 0, timeout: 20_000 })
}
async function dodoCall<T>(action:(client:DodoPayments)=>Promise<T>, discountLookup = false) {
  try {return await action(dodo())}
  catch(error) {
    if(error instanceof HttpError) throw error
    if (discountLookup) throw discountRequestError(record(error).status)
    // 支付 SDK 的原始错误不进入用户响应或日志，避免携带请求头及客户数据。
    throw new HttpError(502,'支付通道暂时不可用，请稍后查询订单','PAYMENT_PROVIDER_ERROR')
  }
}
async function creem(path: string, body?: object, discountLookup = false): Promise<Record<string, unknown>> {
  const key = setting('creem', 'API_KEY')
  if (!key) throw new HttpError(503, '支付通道尚未配置', 'PAYMENT_UNCONFIGURED')
  try {
    const response = await fetch(`${paymentMode() === 'live' ? 'https://api.creem.io' : 'https://test-api.creem.io'}/v1/${path}`, {
      method: body ? 'POST' : 'GET', headers: { 'x-api-key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
    })
    if (!response.ok) {
      if (discountLookup) throw discountRequestError(response.status)
      throw new Error('支付平台请求失败')
    }
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('支付平台响应无效')
    return data as Record<string, unknown>
  } catch (error) {
    if (error instanceof HttpError) throw error
    if (discountLookup) throw discountRequestError(undefined)
    // 原始响应和网络异常可能包含密钥或客户信息，不进入响应与日志。
    throw new HttpError(502, '支付通道暂时不可用，请稍后查询订单', 'PAYMENT_PROVIDER_ERROR')
  }
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
  quoted_discount?: CreditDiscount | null; paid_discount?: CreditDiscount | null;
}
export interface PaymentReceipt {
  checkoutId: string; paymentId: string; productId: string; amount: number; currency: string;
  paidAmount: number; refundedAmount: number; disputed: boolean;
  discount?: CreditDiscount | null;
}

function discountRequestError(status: unknown) {
  if (status === 404) return new HttpError(400, '折扣代码不存在', 'DISCOUNT_INVALID')
  if (status === 401 || status === 403) return new HttpError(503, '当前通道尚未配置折扣验证权限', 'DISCOUNT_UNCONFIGURED')
  return new HttpError(503, '暂时无法验证折扣代码，请稍后重试', 'DISCOUNT_UNAVAILABLE')
}

export interface ProviderDiscount {
  id: string; code: string; percentBps: number; productIds: string[];
  startsAt?: string | null; expiresAt?: string | null; usageLimit?: number | null; used: number; active: boolean;
  status?: string;
}

/** 先核对券的静态规则；付款后的核验不再用当前有效期或剩余次数否定历史付款。 */
export async function readProviderDiscount(provider: PaymentProvider, lookup: { code: string } | { id: string }): Promise<ProviderDiscount> {
  const p = provider === 'creem'
    ? await creem(`discounts?${'code' in lookup ? 'discount_code' : 'discount_id'}=${encodeURIComponent('code' in lookup ? lookup.code : lookup.id)}`, undefined, true)
    : record(await dodoCall(client => 'code' in lookup ? client.discounts.retrieveByCode(lookup.code) : client.discounts.retrieve(lookup.id), true))
  const id = provider === 'creem' ? p.id : p.discount_id
  let code: string
  try { code = normalizeCreditDiscountCode(String(p.code ?? '')) } catch { throw new HttpError(400, '此折扣代码不支持在 AIGC 使用', 'DISCOUNT_UNSUPPORTED') }
  const percentage = provider === 'creem' ? p.percentage : p.amount
  const rawBps = Number(percentage) * (provider === 'creem' ? 100 : 1), bps = Math.round(rawBps)
  const productIds = provider === 'creem' ? p.applies_to_products : p.restricted_to
  const allowed = CREDIT_PACKS.map(pack => productId(provider, pack.id)).filter(Boolean)
  if (p.type !== 'percentage' || typeof percentage !== 'number' || !Number.isSafeInteger(bps) || Math.abs(rawBps - bps) > 0.000001 || bps <= 0 || bps >= 10_000
    || typeof id !== 'string' || !id || id.length > 200 || !code
    || !Array.isArray(productIds) || !productIds.length || productIds.some(id => typeof id !== 'string' || !allowed.includes(id))
    || (provider === 'dodo' && ((p.currency_options != null && (!Array.isArray(p.currency_options) || p.currency_options.length > 0))
      || (p.customer_eligibility != null && p.customer_eligibility !== 'any') || p.per_customer_usage_limit != null)))
    throw new HttpError(400, '此折扣代码不支持在 AIGC 使用，请使用指定 AIGC 商品的普通百分比折扣代码', 'DISCOUNT_UNSUPPORTED')
  check('id' in lookup ? lookup.id === id : lookup.code === code)
  if (provider === 'creem') check(paymentMode() === 'live' ? p.mode === 'prod' : ['test', 'sandbox'].includes(String(p.mode)))
  const startsAt = p.starts_at ?? null, expiresAt = (provider === 'creem' ? p.expiry_date : p.expires_at) ?? null
  const usageLimit = (provider === 'creem' ? p.max_redemptions : p.usage_limit) ?? null
  const used = provider === 'creem' ? p.redeem_count : p.times_used
  if ([startsAt, expiresAt].some(value => value != null && (typeof value !== 'string' || !Number.isFinite(Date.parse(value))))
    || (usageLimit != null && (!Number.isSafeInteger(usageLimit) || Number(usageLimit) < 0))
    || !Number.isSafeInteger(used) || Number(used) < 0
    || (provider === 'creem' && !['active', 'deleted', 'draft', 'expired', 'scheduled'].includes(String(p.status))))
    throw discountRequestError(undefined)
  return { id, code, percentBps: bps, productIds, active: provider === 'dodo' || p.status === 'active',
    startsAt: startsAt as string | null, expiresAt: expiresAt as string | null,
    usageLimit: usageLimit as number | null, used: Number(used), status: typeof p.status === 'string' ? p.status : undefined }
}

export function quoteProviderDiscount(discount: ProviderDiscount, id: string, amount: number): CreditDiscount {
  if (!discount.productIds.includes(id)) throw new HttpError(400, '此折扣代码不适用于当前套餐', 'DISCOUNT_PRODUCT')
  const now = Date.now()
  if (discount.status === 'scheduled') throw new HttpError(400, '折扣代码尚未生效', 'DISCOUNT_NOT_STARTED')
  if (discount.status === 'expired') throw new HttpError(400, '折扣代码已过期', 'DISCOUNT_EXPIRED')
  if (discount.startsAt && Date.parse(discount.startsAt) > now) throw new HttpError(400, '折扣代码尚未生效', 'DISCOUNT_NOT_STARTED')
  if (discount.expiresAt && Date.parse(discount.expiresAt) <= now) throw new HttpError(400, '折扣代码已过期', 'DISCOUNT_EXPIRED')
  if (!discount.active) throw new HttpError(400, '折扣代码当前不可用', 'DISCOUNT_INACTIVE')
  if (discount.usageLimit != null && discount.used >= discount.usageLimit) throw new HttpError(400, '折扣代码使用次数已用完', 'DISCOUNT_EXHAUSTED')
  const payableAmount = discountPayableAmount(amount, discount.percentBps)
  if (payableAmount <= 0) throw new HttpError(400, '此折扣代码不能用于零元购买', 'DISCOUNT_UNSUPPORTED')
  return { id: discount.id, code: discount.code, percentBps: discount.percentBps, payableAmount, discountAmount: amount - payableAmount }
}

async function receiptDiscount(order: PaymentOrderSnapshot, id: string, paid: number, detail?: Record<string, unknown>): Promise<CreditDiscount> {
  const frozen = [order.paid_discount, order.quoted_discount].find(item => item?.id === id)
  let rule: CreditDiscount | ProviderDiscount
  try { rule = frozen ?? await readProviderDiscount(order.provider, { id }) }
  catch (error) {
    if (error instanceof HttpError && error.status === 400) check(false)
    throw error
  }
  if ('productIds' in rule) check(rule.productIds.includes(order.product_id))
  if (detail) {
    check(detail.type == null || detail.type === 'percentage')
    const code = detail.code ?? detail.discountCode
    if (code != null) check(code === rule.code)
    // Creem Checkout 的 amount 表示百分比；Dodo 的 amount 使用基点。
    const bps = order.provider === 'dodo' ? detail.amount : detail.percentage ?? detail.amount
    if (bps != null) check(typeof bps === 'number' && Math.abs(bps * (order.provider === 'dodo' ? 1 : 100) - rule.percentBps) <= 0.000001)
  }
  check(matchesDiscountPayment(order.amount, rule.percentBps, paid))
  return { id, code: rule.code, percentBps: rule.percentBps, payableAmount: paid, discountAmount: order.amount - paid }
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
    const checkout = await creem('checkouts', { product_id: order.product_id, units: 1, request_id: order.id, success_url: returnUrl, customer: { email }, metadata,
      ...(order.quoted_discount ? { discount_code: order.quoted_discount.code } : {}) })
    check(typeof checkout.id === 'string' && typeof checkout.checkout_url === 'string')
    return { id: String(checkout.id), url: validateCheckoutUrl(String(checkout.checkout_url), 'creem') }
  }
  const checkout = await dodoCall(client=>client.checkoutSessions.create({
    product_cart: [{ product_id: order.product_id, quantity: 1 }], customer: { email }, return_url: returnUrl, metadata,
    billing_currency: order.currency, feature_flags: { allow_currency_selection: false, allow_discount_code: false },
    ...(order.quoted_discount ? { discount_codes: [order.quoted_discount.code] } : {}),
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
    const applied = p.discounts ?? []
    check(applied.length <= 1)
    const discountId = applied[0]?.discount_id ?? p.discount_id
    check(!p.discount_id || !applied.length || p.discount_id === discountId)
    let discount: CreditDiscount | null = null
    if (discountId) {
      check(order.quoted_discount?.id === discountId || order.paid_discount?.id === discountId)
      discount = await receiptDiscount(order, discountId, p.total_amount, applied[0] && record(applied[0]))
    } else check(p.total_amount === order.amount && !order.quoted_discount)
    const refundedAmount = p.refunds.filter(item => item.status === 'succeeded').reduce((sum, item) => {
      check(Number.isSafeInteger(item.amount) && Number(item.amount)>0 && item.currency === order.currency)
      return sum+Number(item.amount)
    },0)
    return { checkoutId: order.checkout_id, paymentId: p.payment_id, productId: order.product_id,
      amount: order.amount, currency: p.currency, paidAmount: p.total_amount, refundedAmount, disputed: p.disputes.length > 0, discount }
  }
  return readCreemReceipt(order)
}
function entityId(value: unknown): string | undefined {
  const id = typeof value === 'string' ? value : record(value).id
  return typeof id === 'string' && id.length > 0 && id.length <= 200 ? id : undefined
}
function confirmationPending(): never {
  throw new HttpError(503, '支付平台尚未确认最新付款状态，请稍后查询订单', 'PAYMENT_CONFIRMATION_PENDING')
}
async function readCreemReceipt(order: PaymentOrderSnapshot, expectedTransaction?: string): Promise<PaymentReceipt | null> {
  check(order.provider_mode === paymentMode() && order.scope === runtimeScope())
  if (!order.checkout_id) return null
  const checkout = await creem(`checkouts?checkout_id=${encodeURIComponent(order.checkout_id)}`)
  checkMetadata(checkout.metadata, order)
  if (checkout.status !== 'completed') return null
  const paid = record(checkout.order), paymentId = entityId(paid), transactionId = entityId(paid.transaction)
  check(checkout.id === order.checkout_id && checkout.request_id === order.id && entityId(checkout.product) === order.product_id
    && (checkout.units ?? 1) === 1 && checkout.custom_price == null
    && paid.product === order.product_id && paid.currency === order.currency && paid.amount === order.amount
    && paid.type === 'onetime' && !checkout.subscription)
  if (paid.status !== 'paid') return null
  check(paymentId)
  if (!transactionId) confirmationPending()
  if (expectedTransaction) check(transactionId === expectedTransaction)
  const [p, transaction] = await Promise.all([
    typeof checkout.product === 'string' ? creem(`products?product_id=${encodeURIComponent(order.product_id)}`) : Promise.resolve(record(checkout.product)),
    creem(`transactions?transaction_id=${encodeURIComponent(transactionId)}`),
  ])
  // 商品价格可能在付款后调整。实付与创建时快照核对，不用商品当前售价改写旧订单。
  check(p.id === order.product_id && p.currency === order.currency && p.billing_type === 'onetime' && p.tax_mode === 'inclusive')
  check(transaction.id === transactionId && transaction.order === paymentId && transaction.currency === order.currency
    && transaction.type === 'payment' && !transaction.subscription
    && (order.provider_mode === 'live' ? transaction.mode === 'prod' : ['test', 'sandbox'].includes(String(transaction.mode))))
  const disputed = transaction.status === 'chargedBack' || transaction.status === 'chargeback'
  if (!disputed && !['paid', 'refunded', 'partialRefund'].includes(String(transaction.status))) return null
  if (transaction.amount_paid == null) confirmationPending()
  const paidAmount = Number(transaction.amount_paid)
  check(Number.isSafeInteger(transaction.amount_paid) && paidAmount > 0 && paidAmount <= order.amount)
  const discountId = entityId(paid.discount) ?? entityId(checkout.discount)
  let discount: CreditDiscount | null = null
  if (discountId) {
    check(!entityId(checkout.discount) || entityId(checkout.discount) === discountId)
    check(paid.discount_amount != null && transaction.discount_amount != null
      && Number.isSafeInteger(paid.discount_amount) && Number.isSafeInteger(transaction.discount_amount)
      && paid.discount_amount === transaction.discount_amount && Number(paid.discount_amount) >= 0)
    discount = await receiptDiscount(order, discountId, paidAmount, typeof checkout.discount === 'object' ? record(checkout.discount) : undefined)
    // 含税商品分别核对税前优惠、含税应付和交易实付，不把税前优惠误当现金优惠。
    check(paid.amount_paid == null || paid.amount_paid === paidAmount)
    check(paid.amount_due == null || paid.amount_due === paidAmount)
    const cashDiscount = discount.discountAmount
    for (const value of [paid.discount_amount, transaction.discount_amount]) {
      check(value != null && Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= cashDiscount)
    }
    check(paid.discount_amount === transaction.discount_amount)
    if (paid.discount_amount !== cashDiscount) {
      check(Number.isSafeInteger(paid.sub_total) && Number.isSafeInteger(paid.tax_amount)
        && Number(paid.sub_total) + Number(paid.tax_amount) - Number(paid.discount_amount) === paidAmount)
    }
  } else {
    check(paidAmount === order.amount && (paid.discount_amount == null || paid.discount_amount === 0)
      && (transaction.discount_amount == null || transaction.discount_amount === 0))
  }
  const refundedAmount = transaction.refunded_amount ?? 0
  if (['refunded', 'partialRefund'].includes(String(transaction.status)) && refundedAmount === 0) confirmationPending()
  check(Number.isSafeInteger(refundedAmount) && Number(refundedAmount) >= 0 && Number(refundedAmount) <= Number(transaction.amount_paid))
  return { checkoutId: order.checkout_id, paymentId: paymentId!, productId: order.product_id,
    amount: order.amount, currency: order.currency, paidAmount, refundedAmount: Number(refundedAmount), disputed, discount }
}
export async function readCreemReversal(order: PaymentOrderSnapshot & { payment_id: string | null }, type: string, data: Record<string, unknown>) {
  const eventTransaction = record(data.transaction), paymentId = entityId(data.order) ?? entityId(eventTransaction.order)
  const checkoutId = entityId(data.checkout)
  check((!paymentId || !order.payment_id || paymentId === order.payment_id)
    && (!checkoutId || !order.checkout_id || checkoutId === order.checkout_id))
  const receipt = await readCreemReceipt({ ...order, checkout_id: order.checkout_id ?? checkoutId ?? null }, entityId(data.transaction))
  if (!receipt) confirmationPending()
  check(!paymentId || paymentId === receipt.paymentId)
  const currency = type === 'refund.created' ? data.refund_currency : data.currency
  const amount = type === 'refund.created' ? data.refund_amount : data.amount
  check(currency === receipt.currency && Number.isSafeInteger(amount) && Number(amount) > 0 && Number(amount) <= receipt.paidAmount)
  if (type === 'dispute.created') {
    if (!receipt.disputed) confirmationPending()
  } else {
    const cumulative = eventTransaction.refunded_amount
    if (cumulative != null) check(Number.isSafeInteger(cumulative) && Number(cumulative) >= Number(amount) && Number(cumulative) <= receipt.paidAmount)
    // 查询必须已反映这次退款；不把单次退款金额当成累计值写到账本。
    if (receipt.refundedAmount < Number(amount) || (cumulative != null && receipt.refundedAmount < Number(cumulative))) confirmationPending()
  }
  return { ...receipt, reversalAmount: type === 'dispute.created' ? Math.max(Number(amount), receipt.refundedAmount) : receipt.refundedAmount }
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
