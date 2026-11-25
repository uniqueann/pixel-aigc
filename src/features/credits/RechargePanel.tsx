import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@/store/useUserStore'
import { BILLING_REFRESH_EVENT, checkoutCredits, getBillingCatalog, getCreditOrder, listCreditOrders, refreshBillingBalance, requestCashRefund } from '@/services/api/billing'
import type { ApiError } from '@/services/api/client'
import { formatCreditPrice, type BillingCatalog, type CreditOrder, type PaymentProvider } from '@shared/billing'
import { translateApiError } from '@/i18n/apiErrors'
import { formatDateTime } from '@/i18n/format'
import BillingExplanation from './BillingExplanation'
import CreditPackPurchase from './CreditPackPurchase'
import type { CreditDiscount } from '@shared/credit-discounts'

const PROVIDER_LABELS: Record<PaymentProvider, string> = { dodo: 'Dodo Payments', creem: 'Creem' }
const ORDER_EXPIRY_MS = 30 * 60 * 1000

function isOrderExpired(createdAt: string) {
  const age = Date.now() - new Date(createdAt).getTime()
  return !Number.isNaN(age) && age > ORDER_EXPIRY_MS
}

function errorText(cause: unknown, fallback: string) {
  const apiError = cause as ApiError | undefined
  return translateApiError({
    code: apiError?.code,
    extra: apiError?.extra,
    message: cause instanceof Error ? cause.message : undefined,
    fallback,
  })
}

export default function RechargePanel({ open, onPaid }: { open: boolean; onPaid: () => void }) {
  const { t } = useTranslation('credits')
  const owner = useUserStore(state => state.userId)
  // Reset catalog, orders, selected provider, and refund modal when switching accounts.
  return owner ? <AccountRechargePanel key={owner} owner={owner} open={open} onPaid={onPaid} />
    : <Alert type="info" message={t('recharge.signInFirst')} />
}
function AccountRechargePanel({ owner, open, onPaid }: { owner: string; open: boolean; onPaid: () => void }) {
  const { t } = useTranslation(['credits', 'common'])
  const [catalog, setCatalog] = useState<BillingCatalog>()
  const [orders, setOrders] = useState<CreditOrder[]>([])
  const [provider, setProvider] = useState<PaymentProvider>('dodo')
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [refundOrder, setRefundOrder] = useState<CreditOrder>()
  const [refundReason, setRefundReason] = useState('')
  const [dismissedOrderIds, setDismissedOrderIds] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(`pixel:dismissed-orders:${owner}`)
      return saved ? new Set(JSON.parse(saved)) : new Set<string>()
    } catch {
      return new Set<string>()
    }
  })
  const [showDismissed, setShowDismissed] = useState(false)

  const dismissOrder = (id: string) => {
    setDismissedOrderIds(prev => {
      const next = new Set(prev)
      next.add(id)
      try {
        localStorage.setItem(`pixel:dismissed-orders:${owner}`, JSON.stringify([...next]))
      } catch { /* ignore */ }
      return next
    })
  }

  const restoreOrder = (id: string) => {
    setDismissedOrderIds(prev => {
      const next = new Set(prev)
      next.delete(id)
      try {
        localStorage.setItem(`pixel:dismissed-orders:${owner}`, JSON.stringify([...next]))
      } catch { /* ignore */ }
      return next
    })
  }
  // Keep discount panel expanded and draft code across provider changes; verified quote clears inside CreditPackPurchase.
  const [discountExpanded, setDiscountExpanded] = useState(false)
  const [trackedOpen, setTrackedOpen] = useState(open)
  if (open !== trackedOpen) {
    setTrackedOpen(open)
    if (!open) setDiscountExpanded(false)
  }
  const version = useRef(0)
  const mounted = useRef(true)
  const isCurrentOwner = useCallback(() => mounted.current && useUserStore.getState().userId === owner, [owner])
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const invalidate = useCallback(() => { version.current++ }, [])
  const load = useCallback(async () => {
    const current = ++version.current
    try {
      const [next, history] = await Promise.all([getBillingCatalog(owner), listCreditOrders(owner)])
      if (current !== version.current || !isCurrentOwner()) return
      setCatalog(next); setOrders(history.items); setProvider(value => next.providers.includes(value) ? value
        : next.providers.includes('dodo') ? 'dodo' : next.providers[0] ?? 'dodo')
      useUserStore.getState().setCredits(next.balance); setError(undefined)
    } catch (cause) { if (current === version.current && isCurrentOwner()) setError(errorText(cause, t('credits:recharge.loadFailed'))) }
  }, [owner, isCurrentOwner, t])
  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active && open) void load() })
    return () => { active = false; invalidate() }
  }, [open, load, invalidate])
  useEffect(() => {
    if (!open) return
    const update = () => void load()
    window.addEventListener(BILLING_REFRESH_EVENT, update)
    return () => window.removeEventListener(BILLING_REFRESH_EVENT, update)
  }, [open, load])
  const checkOrder = async (id: string) => {
    if (!isCurrentOwner()) return
    setBusy(id)
    try {
      const order = await getCreditOrder(id, owner)
      if (!isCurrentOwner()) return
      setOrders(items => items.map(item => item.id === id ? order : item))
      if (order.status === 'paid') { await refreshBillingBalance(owner); if (isCurrentOwner()) onPaid() }
      if (!isCurrentOwner()) return
      setError(undefined)
    } catch (cause) { if (isCurrentOwner()) setError(errorText(cause, t('credits:recharge.orderCheckFailed'))) }
    finally { if (isCurrentOwner()) setBusy(undefined) }
  }
  const purchase = async (pack: NonNullable<BillingCatalog['packs'][number]>, discount?: CreditDiscount) => {
    if (!isCurrentOwner() || !catalog || !pack.providers.includes(provider) || catalog.paymentBlocked || busy) return
    setBusy(pack.id); setError(undefined)
    try {
      const args = [pack.id, provider, crypto.randomUUID(), owner, pack.amount, catalog.currency] as const
      const order = await (discount ? checkoutCredits(...args, { discountCode: discount.code, expectedPayableAmount: discount.payableAmount }) : checkoutCredits(...args))
      if (!isCurrentOwner()) return
      setOrders(items => [order, ...items.filter(item => item.id !== order.id)])
      if (order.checkoutUrl) window.location.assign(order.checkoutUrl)
      else setError(t('credits:recharge.checkoutPending'))
    } catch (cause) {
      if (isCurrentOwner() && !discount) setError(errorText(cause, t('credits:recharge.orderCreateFailed')))
      throw cause
    }
    finally { if (isCurrentOwner()) setBusy(undefined) }
  }
  const orderLine = (order: CreditOrder, prefix: string) => t('credits:recharge.orderLine', {
    prefix,
    price: formatCreditPrice(order.paidAmount ?? order.quotedAmount ?? order.amount, order.currency),
    credits: order.credits,
    status: t(`credits:recharge.orderStatus.${order.status}` as never, { defaultValue: order.status }),
  })
  return <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 24 }}>
    <span>{t('credits:recharge.intro')}</span>
    {error ? <Alert type="error" message={error} action={<Button size="small" onClick={() => void load()}>{t('common:actions.retry')}</Button>} /> : null}
    {!catalog ? <span>{t('credits:recharge.loadingPacks')}</span> : <>
      <span>{t('credits:recharge.currencyLabel', { currency: t(`credits:recharge.currencies.${catalog.currency}` as never, { defaultValue: catalog.currency }) })}</span>
      {catalog.providers.length > 1 ? <Select aria-label={t('credits:recharge.paymentMethodAria')} value={provider} onChange={setProvider} style={{ width: '100%' }} options={catalog.providers.map(value => ({ value, label: PROVIDER_LABELS[value] }))} />
        : catalog.providers.length === 1 ? <span>{t('credits:recharge.paymentMethodLabel', { provider: PROVIDER_LABELS[catalog.providers[0]] })}</span> : null}
      {!catalog.providers.length ? <Alert type="info" message={t('credits:recharge.paymentsClosed')} /> : null}
      {catalog.paymentBlocked ? <Alert type="warning" message={t('credits:recharge.paymentBlocked')} /> : null}
      <CreditPackPurchase key={JSON.stringify([owner, open, catalog.currency, catalog.packs, catalog.providers])}
        owner={owner} catalog={catalog} provider={provider} providerLabel={PROVIDER_LABELS[provider]} busy={busy}
        expanded={discountExpanded} onExpand={() => setDiscountExpanded(true)} onPurchase={purchase} />
      <BillingExplanation freeBgRemoveRemaining={catalog.freeBgRemoveRemaining} freeBgRemoveMonth={catalog.freeBgRemoveMonth} />
      <small>{t('credits:recharge.refundPolicy')}</small>
    </>}
    {orders.length ? <><strong>{t('credits:recharge.ordersTitle')}</strong>{orders.filter(o => !dismissedOrderIds.has(o.id)).map(order => {
      const isExpired = order.status === 'pending' && isOrderExpired(order.createdAt)
      const appliedDiscount = order.paidAmount != null ? order.paidDiscount : order.quotedDiscount
      return (
        <div key={order.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <span>{orderLine(order, order.paidAmount == null && order.quotedDiscount ? t('credits:recharge.estimatedPrefix') : '')}</span>
            {isExpired ? <Tag style={{ marginLeft: 6, fontSize: 11 }}>{t('credits:recharge.orderExpiredTag')}</Tag> : null}
            {appliedDiscount ? <small style={{ display: 'block' }}>{t('credits:recharge.orderDiscountMeta', { originalPrice: formatCreditPrice(order.amount, order.currency), code: appliedDiscount.code })}</small> : null}
            <small style={{ display: 'block', color: 'var(--color-text-secondary)' }}>{formatDateTime(order.createdAt)} · {PROVIDER_LABELS[order.provider]}</small>
          </div>
          <Space style={{ marginTop: 6 }}>
            {order.status === 'pending' ? (
              <>
                <Button size="small" loading={busy === order.id} onClick={() => void checkOrder(order.id)}>{t('credits:recharge.checkOrder')}</Button>
                {order.checkoutUrl && !isExpired ? (
                  <Button size="small" onClick={() => window.location.assign(order.checkoutUrl!)}>{t('credits:recharge.continuePay')}</Button>
                ) : null}
                <Button size="small" type="text" onClick={() => dismissOrder(order.id)}>{t('credits:recharge.dismissOrder')}</Button>
              </>
            ) : null}
            {order.status === 'paid' ? (
              <Button size="small" disabled={order.refundRequested} onClick={() => { setRefundOrder(order); setRefundReason('') }}>
                {order.refundRequested ? t('credits:recharge.refundSubmitted') : t('credits:recharge.requestRefund')}
              </Button>
            ) : null}
          </Space>
        </div>
      )
    })}
    {orders.some(o => dismissedOrderIds.has(o.id)) ? (
      <div style={{ marginTop: 8 }}>
        <Button size="small" type="link" onClick={() => setShowDismissed(s => !s)} style={{ padding: 0, fontSize: 12 }}>
          {showDismissed
            ? t('credits:recharge.hideDismissed')
            : t('credits:recharge.showDismissed', { count: orders.filter(o => dismissedOrderIds.has(o.id)).length })}
        </Button>
        {showDismissed ? (
          <div style={{ marginTop: 8, paddingLeft: 8, borderLeft: '2px solid var(--color-border)' }}>
            {orders.filter(o => dismissedOrderIds.has(o.id)).map(order => (
              <div key={order.id} style={{ padding: '6px 0', fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--color-text-secondary)' }}>
                  {orderLine(order, '')}
                </span>
                <Button size="small" type="text" onClick={() => restoreOrder(order.id)}>{t('credits:recharge.restoreOrder')}</Button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    ) : null}</> : null}
    <Modal open={Boolean(refundOrder)} title={t('credits:recharge.refundModalTitle')} okText={t('credits:recharge.refundModalOk')} cancelText={t('common:actions.cancel')} okButtonProps={{ disabled: !refundReason.trim() }} confirmLoading={busy === 'refund'} onCancel={() => setRefundOrder(undefined)}
      onOk={() => void (async () => {
        if (!refundOrder || !isCurrentOwner() || !refundReason.trim()) return
        setBusy('refund')
        try {
          const next = await requestCashRefund(refundOrder.id, refundReason.trim(), owner)
          if (!isCurrentOwner()) return
          setOrders(items => items.map(item => item.id === next.id ? next : item)); setRefundOrder(undefined)
        } catch (cause) { if (isCurrentOwner()) setError(errorText(cause, t('credits:recharge.refundModalFailed'))) }
        finally { if (isCurrentOwner()) setBusy(undefined) }
      })()}>
      <p>{t('credits:recharge.refundModalNote')}</p>
      {error ? <Alert type="error" message={error} /> : null}
      <Input.TextArea aria-label={t('credits:recharge.refundReasonAria')} value={refundReason} onChange={event => setRefundReason(event.target.value)} maxLength={500} placeholder={t('credits:recharge.refundReasonPlaceholder')} />
    </Modal>
  </Space>
}
