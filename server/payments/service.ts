import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { CREDIT_PACKS, BG_REMOVE_MONTHLY_FREE, SYNC_PRICE_VERSION, type CreditOrder, type PaymentProvider } from '../../shared/billing.js'
import { database, runtimeScope, withIdentity, type Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { ensureCreditAccount } from '../image-jobs/billing.js'
import {
  configuredProviders, createPaymentCheckout, creditCurrency, paymentMode, productId, readCreemReversal, readPaymentReceipt,
  record, validateProduct, verifyPaymentEvent, type PaymentOrderSnapshot, type PaymentReceipt,
} from './providers.js'

export interface BillingUser { id: string; email: string }
export interface StoredCreditOrder extends PaymentOrderSnapshot {
  pack_id: CreditOrder['packId']; status: CreditOrder['status']; checkout_url: string | null;
  refund_requested: boolean; created_at: Date | string; payment_id: string | null; refunded_amount: number;
}
const orderIdSchema = z.uuid()
export function withBillingWorker<T>(action: (sql: Transaction) => Promise<T>): Promise<T> {
  return database().begin(async sql => {
    await sql`set local role aigc_billing_worker`
    await sql`select set_config('aigc.scope',${runtimeScope()},true)`
    return action(sql)
  }) as Promise<T>
}
export function presentOrder(o: StoredCreditOrder): CreditOrder {
  return { id: o.id, packId: o.pack_id, provider: o.provider, amount: Number(o.amount), currency: o.currency,
    credits: Number(o.credits), status: o.status, checkoutUrl: o.checkout_url, refundRequested: o.refund_requested,
    createdAt: o.created_at instanceof Date ? o.created_at.toISOString() : String(o.created_at) }
}
export async function billingCatalog(user: BillingUser) {
  const currency = creditCurrency()
  return withIdentity(user.id, user.email, async sql => {
    const balance = await ensureCreditAccount(sql, user.id)
    await sql`select aigc.expire_sync_credits()`
    const [free] = await sql`select to_char(now() at time zone 'Asia/Shanghai','YYYY-MM') as month,
      count(*) filter(where state<>'refunded')::integer as used from aigc.sync_credit_jobs
      where free_month=to_char(now() at time zone 'Asia/Shanghai','YYYY-MM')`
    const [account] = await sql`select balance,payment_blocked from aigc.credit_accounts`
    return { currency, priceVersion: SYNC_PRICE_VERSION, balance: Number(account?.balance ?? balance),
      paymentBlocked: Boolean(account?.payment_blocked), freeBgRemoveMonth: String(free.month),
      freeBgRemoveRemaining: Math.max(0,BG_REMOVE_MONTHLY_FREE-Number(free.used)), providers: configuredProviders(),
      packs: CREDIT_PACKS.map(pack => ({ id: pack.id, name: pack.name, credits: pack.credits, amount: pack[currency], providers: configuredProviders(pack.id) })) }
  })
}
function publicOrigin() {
  const value = process.env.AIGC_PUBLIC_ORIGIN
  if (!value) throw new HttpError(503, '充值返回地址尚未配置', 'PAYMENT_UNCONFIGURED')
  const url = new URL(value)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || (url.protocol !== 'https:' && !(runtimeScope() === 'local' && url.hostname === 'localhost')))
    throw new HttpError(503, '充值返回地址配置无效', 'PAYMENT_UNCONFIGURED')
  return url.origin
}
export async function createCreditCheckout(user: BillingUser, input: unknown) {
  const parsed = z.object({ orderId: z.uuid(), packId: z.enum(['starter','standard','studio']), provider: z.enum(['creem','dodo']),
    expectedAmount:z.number().int().positive(),expectedCurrency:z.enum(['USD','CNY']) }).strict().parse(input)
  const pack = CREDIT_PACKS.find(item => item.id === parsed.packId)!, currency = creditCurrency()
  if(parsed.expectedAmount!==pack[currency] || parsed.expectedCurrency!==currency) throw new HttpError(409,'充值价格已更新，请刷新套餐后重新购买','PRICE_CHANGED')
  if (!configuredProviders(pack.id).includes(parsed.provider)) throw new HttpError(503, '充值通道尚未开放', 'PAYMENT_UNCONFIGURED')
  const id = productId(parsed.provider, pack.id)!, returnUrl = `${publicOrigin()}/?creditOrder=${parsed.orderId}`
  await validateProduct(parsed.provider,id,pack[currency],currency)
  const order = await withIdentity(user.id,user.email,async sql => {
    await ensureCreditAccount(sql,user.id)
    // aigc_api 不能对 credit_accounts 执行 FOR UPDATE。行锁在定义者函数内取得，并保持到本事务结束。
    const [account] = await sql`select aigc.lock_credit_account_for_checkout(${user.id}) as payment_blocked`
    if (account.payment_blocked) throw new HttpError(409,'积分账户需要人工核对，请联系支持','CREDIT_ACCOUNT_REVIEW')
    const [prior] = await sql`select * from aigc.credit_orders where id=${parsed.orderId}`
    if (prior) {
      if (prior.pack_id !== parsed.packId || prior.provider !== parsed.provider || prior.amount !== pack[currency] || prior.currency !== currency)
        throw new HttpError(409,'订单编号已用于其他套餐','ORDER_CONFLICT')
      return { o: prior as StoredCreditOrder, reused: true }
    }
    const [count] = await sql`select count(*)::integer as count from aigc.credit_orders where created_at>now()-interval '1 hour'`
    if (Number(count.count)>=20) throw new HttpError(429,'创建充值订单过于频繁，请稍后重试','RATE_LIMITED')
    const [created] = await sql`insert into aigc.credit_orders(id,user_id,scope,provider,provider_mode,pack_id,product_id,amount,currency,credits)
      values(${parsed.orderId},${user.id},${runtimeScope()},${parsed.provider},${paymentMode()},${pack.id},${id},${pack[currency]},${currency},${pack.credits}) returning *`
    return { o: created as StoredCreditOrder, reused: false }
  })
  if (order.reused) {
    if (!order.o.checkout_url) throw new HttpError(409,'此订单的支付链接尚未确认，请刷新订单或稍后重新创建','CHECKOUT_PENDING')
    return presentOrder(order.o)
  }
  let checkout: { id: string; url: string }
  try { checkout = await createPaymentCheckout(order.o,user.email,returnUrl) }
  catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502,'支付链接尚未确认，请稍后查询订单','PAYMENT_PROVIDER_ERROR')
  }
  return withIdentity(user.id,user.email,async sql => {
    const [row] = await sql`update aigc.credit_orders set checkout_id=${checkout.id},checkout_url=${checkout.url},updated_at=now() where id=${order.o.id} returning *`
    return presentOrder(row as StoredCreditOrder)
  })
}
async function reverseCreemReceipt(sql: Transaction, order: StoredCreditOrder, receipt: PaymentReceipt, cash: number, eventId: string, eventType: string) {
  if (receipt.disputed) {
    // 保持已有累计退款金额，争议查询缺少金额时仍须冻结账户，不能因金额回退被数据库忽略。
    const [current] = await sql`select refunded_amount from aigc.credit_orders where id=${order.id} and scope=${runtimeScope()} for update`
    if (!current) throw new HttpError(409,'充值订单尚未就绪，请重试回调','ORDER_NOT_READY')
    cash = Math.max(cash, Number(current.refunded_amount))
  }
  await sql`select aigc.reverse_credit_order(${order.id},${cash},${receipt.currency},${eventId},${receipt.disputed ? 'dispute.created' : eventType})`
}
export async function reconcileCreditOrder(order: StoredCreditOrder, eventId = `reconcile:${randomUUID()}`, eventType = 'reconcile') {
  const receipt = await readPaymentReceipt(order)
  if (!receipt) return false
  await withBillingWorker(async sql => {
    // Creem 查单已出现退款/争议时先处理撤销，未到账订单进入核对，避免先发整包再扣回。
    if (order.provider === 'creem' && (receipt.refundedAmount > 0 || receipt.disputed)) {
      await reverseCreemReceipt(sql, order, receipt, receipt.refundedAmount, eventId, 'refund.created')
      return
    }
    await sql`select aigc.complete_credit_order(${order.id},${receipt.checkoutId},${receipt.paymentId},${receipt.productId},
      ${receipt.amount},${receipt.currency},${receipt.paidAmount},${eventId},${eventType})`
    if (receipt.refundedAmount>0 || receipt.disputed) await sql`select aigc.reverse_credit_order(${order.id},
      ${receipt.disputed ? receipt.paidAmount : receipt.refundedAmount},${receipt.currency},${`${eventId}:reversal`},${receipt.disputed ? 'dispute.created' : 'refund.succeeded'})`
  })
  return true
}
export async function getCreditOrder(user: BillingUser, id: string, refresh = true) {
  orderIdSchema.parse(id)
  let o = await withIdentity(user.id,user.email,async sql => {
    const [row] = await sql`select * from aigc.credit_orders where id=${id}`
    if (!row) throw new HttpError(404,'充值订单不存在','ORDER_NOT_FOUND')
    return row as StoredCreditOrder
  })
  if (refresh && o.status === 'pending' && o.checkout_id) {
    const claimed = await withBillingWorker(sql => sql`update aigc.credit_orders set last_checked_at=now()
      where id=${id} and scope=${runtimeScope()} and (last_checked_at is null or last_checked_at<now()-interval '20 seconds') returning id`)
    if (claimed.length) await reconcileCreditOrder(o)
    o = await withIdentity(user.id,user.email,async sql => (await sql`select * from aigc.credit_orders where id=${id}`)[0] as StoredCreditOrder)
  }
  return presentOrder(o)
}
export async function listCreditOrders(user: BillingUser) {
  return withIdentity(user.id,user.email,async sql => ({ items: (await sql`select * from aigc.credit_orders order by created_at desc limit 30`).map(row => presentOrder(row as StoredCreditOrder)) }))
}
export async function requestCashRefund(user: BillingUser, id: string, input: unknown) {
  orderIdSchema.parse(id)
  const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).strict().parse(input)
  return withIdentity(user.id,user.email,async sql => {
    const [row] = await sql`update aigc.credit_orders set refund_requested=true,refund_reason=${reason},
      refund_requested_at=coalesce(refund_requested_at,now()),updated_at=now() where id=${id} and status='paid' returning *`
    if (!row) throw new HttpError(409,'只有已付款的充值订单可以申请退款','REFUND_UNAVAILABLE')
    return presentOrder(row as StoredCreditOrder)
  })
}
function textId(value: unknown) {
  return typeof value === 'string' && value.length>0 && value.length<=200 ? value : undefined
}
// Creem 退款/争议的订单实体在 object.order.id，结账在 object.checkout.id。
// transaction.order 只是同一订单号的字符串，事件里可以没有；不能把它当成唯一查找键。
function creemOrderPaymentId(data: Record<string, unknown>) {
  const order = data.order
  if (typeof order === 'string') return textId(order)
  return textId(record(order).id) ?? textId(record(data.transaction).order)
}
function creemCheckoutId(data: Record<string, unknown>) {
  return data.object === 'checkout' ? textId(data.id)
    : textId(data.checkout) ?? textId(record(data.checkout).id)
}
function creemEventMeta(data: Record<string, unknown>) {
  return record(data.metadata ?? record(data.checkout).metadata ?? record(data.order).metadata)
}
export async function handlePaymentWebhook(provider: PaymentProvider, raw: string, headers: Record<string,string|string[]|undefined>) {
  const event = verifyPaymentEvent(provider,raw,headers)
  const type = String(provider === 'creem' ? event.eventType : event.type)
  const data = record(provider === 'creem' ? event.object : event.data)
  const meta = provider === 'creem' ? creemEventMeta(data) : record(data.metadata ?? record(data.checkout).metadata)
  const eventId = String(event.id ?? headers['webhook-id'] ?? '')
  if (!eventId || eventId.length>200) throw new HttpError(400,'支付事件编号无效','INVALID_REQUEST')
  const supported = provider === 'creem' ? ['checkout.completed','refund.created','dispute.created'] : ['payment.succeeded','refund.succeeded','dispute.opened','dispute.accepted','dispute.expired','dispute.lost']
  if (!supported.includes(type)) return { received: true, ignored: true }
  if (meta.productScope != null && meta.productScope !== 'aigc') return { received: true, ignored: true }
  if (meta.productScope === 'aigc' && ((meta.runtimeScope != null && meta.runtimeScope !== runtimeScope())
    || (meta.paymentMode != null && meta.paymentMode !== paymentMode()))) return { received: true, ignored: true }
  const metadataOrderId = meta.productScope === 'aigc' ? meta.orderId : undefined
  // Dodo 退款和争议的 data.payment_id 就是已保存的付款编号，金额改由重新查询付款得出，不读 Creem 的嵌套字段。
  const externalPayment = provider === 'creem' ? creemOrderPaymentId(data) : textId(data.payment_id)
  const checkoutId = provider === 'creem' ? creemCheckoutId(data) : undefined
  const o = await withBillingWorker(async sql => {
    const scope = runtimeScope(), mode = paymentMode()
    if (typeof metadataOrderId === 'string' && orderIdSchema.safeParse(metadataOrderId).success) {
      const rows = await sql`select * from aigc.credit_orders where id=${metadataOrderId} and scope=${scope} and provider=${provider} and provider_mode=${mode}`
      if (rows[0]) return rows[0] as StoredCreditOrder
    }
    if (externalPayment) {
      const rows = await sql`select * from aigc.credit_orders where payment_id=${externalPayment} and scope=${scope} and provider=${provider} and provider_mode=${mode}`
      if (rows[0]) return rows[0] as StoredCreditOrder
    }
    if (checkoutId) {
      const rows = await sql`select * from aigc.credit_orders where checkout_id=${checkoutId} and scope=${scope} and provider=${provider} and provider_mode=${mode}`
      if (rows[0]) return rows[0] as StoredCreditOrder
    }
    return undefined
  })
  if (!o) {
    if (meta.productScope === 'aigc' && meta.runtimeScope === runtimeScope()) throw new HttpError(409,'充值订单尚未就绪，请重试回调','ORDER_NOT_READY')
    return { received: true, ignored: true }
  }
  if (meta.userId != null && meta.userId !== o.user_id) throw new HttpError(409,'支付账号信息不一致','PAYMENT_MISMATCH')
  if (provider === 'creem' && type !== 'checkout.completed') {
    if (type === 'refund.created' && data.status !== 'succeeded') return { received: true, ignored: true }
    const paymentId = creemOrderPaymentId(data), checkout = creemCheckoutId(data)
    if ((paymentId && o.payment_id && paymentId !== o.payment_id) || (checkout && o.checkout_id && checkout !== o.checkout_id)
      || (!paymentId && !checkout && meta.orderId !== o.id))
      throw new HttpError(409,'退款订单信息不一致','PAYMENT_MISMATCH')
    const receipt = await readCreemReversal(o, type, data)
    const cash = receipt.reversalAmount
    await withBillingWorker(sql => reverseCreemReceipt(sql, o, receipt, cash, eventId, type))
  } else {
    if (!o.checkout_id) throw new HttpError(409,'支付链接尚未就绪，请重试回调','ORDER_NOT_READY')
    const confirmed = await reconcileCreditOrder(o,eventId,type)
    if (provider === 'creem' && !confirmed) throw new HttpError(503,'支付平台尚未确认最新付款状态，请稍后查询订单','PAYMENT_CONFIRMATION_PENDING')
  }
  return { received: true }
}
export async function reconcilePendingCreditOrders() {
  const rows = await withBillingWorker(sql => sql`select * from aigc.credit_orders where scope=${runtimeScope()} and provider_mode=${paymentMode()}
    and status='pending' and checkout_id is not null and created_at>now()-interval '30 days'
    and(last_checked_at is null or last_checked_at<now()-interval '5 minutes') order by last_checked_at nulls first,created_at limit 25`)
  let checked = 0, failed = 0
  const deadline=Date.now()+90_000
  for (const row of rows) {
    if(Date.now()+45_000>deadline) break
    try {
      await withBillingWorker(sql => sql`update aigc.credit_orders set last_checked_at=now() where id=${row.id} and scope=${runtimeScope()}`)
      await reconcileCreditOrder(row as StoredCreditOrder); checked++
    } catch { failed++ }
  }
  return { checked, failed }
}
