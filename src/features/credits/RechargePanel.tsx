import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space } from 'antd'
import { useUserStore } from '@/store/useUserStore'
import { BILLING_REFRESH_EVENT, checkoutCredits, getBillingCatalog, getCreditOrder, listCreditOrders, refreshBillingBalance, requestCashRefund } from '@/services/api/billing'
import { formatCreditPrice, type BillingCatalog, type CreditOrder, type PaymentProvider } from '@shared/billing'
import BillingExplanation from './BillingExplanation'
import CreditPackPurchase from './CreditPackPurchase'
import type { CreditDiscount } from '@shared/credit-discounts'

const STATUS_LABELS = {pending:'等待支付确认',paid:'已到账',failed:'支付失败',refunded:'已退款',review:'待人工核对'}
const PROVIDER_LABELS: Record<PaymentProvider, string> = { dodo: 'Dodo Payments', creem: 'Creem' }
export default function RechargePanel({open,onPaid}:{open:boolean;onPaid:()=>void}) {
  const owner=useUserStore(state=>state.userId)
  // 账号变更时重建整个充值面板，目录、订单、付款方式和退款表单都不跨账号保留。
  return owner ? <AccountRechargePanel key={owner} owner={owner} open={open} onPaid={onPaid} />
    : <Alert type="info" message="请先登录再购买积分" />
}
function AccountRechargePanel({owner,open,onPaid}:{owner:string;open:boolean;onPaid:()=>void}) {
  const [catalog,setCatalog]=useState<BillingCatalog>()
  const [orders,setOrders]=useState<CreditOrder[]>([])
  const [provider,setProvider]=useState<PaymentProvider>('dodo')
  const [busy,setBusy]=useState<string>()
  const [error,setError]=useState<string>()
  const [refundOrder,setRefundOrder]=useState<CreditOrder>()
  const [refundReason,setRefundReason]=useState('')
  // 展开状态和已输入代码跨通道保留。已验证报价由购买组件在通道变化时清空。
  const [discountExpanded,setDiscountExpanded]=useState(false)
  const [trackedOpen,setTrackedOpen]=useState(open)
  if (open!==trackedOpen) {
    setTrackedOpen(open)
    if (!open) setDiscountExpanded(false)
  }
  const version=useRef(0)
  const mounted=useRef(true)
  const isCurrentOwner=useCallback(()=>mounted.current && useUserStore.getState().userId===owner,[owner])
  useEffect(()=>{
    mounted.current=true
    return()=>{mounted.current=false}
  },[])
  const invalidate=useCallback(()=>{version.current++},[])
  const load=useCallback(async()=>{
    const current=++version.current
    try {
      const [next,history]=await Promise.all([getBillingCatalog(owner),listCreditOrders(owner)])
      if (current!==version.current || !isCurrentOwner()) return
      setCatalog(next); setOrders(history.items); setProvider(value=>next.providers.includes(value) ? value
        : next.providers.includes('dodo') ? 'dodo' : next.providers[0] ?? 'dodo')
      useUserStore.getState().setCredits(next.balance); setError(undefined)
    } catch(cause) { if(current===version.current && isCurrentOwner()) setError(cause instanceof Error ? cause.message : '充值信息加载失败') }
  },[owner,isCurrentOwner])
  useEffect(()=>{
    let active=true
    queueMicrotask(()=>{if(active && open) void load()})
    return()=>{active=false;invalidate()}
  },[open,load,invalidate])
  useEffect(()=>{
    if(!open) return
    const update=()=>void load()
    window.addEventListener(BILLING_REFRESH_EVENT,update)
    return()=>window.removeEventListener(BILLING_REFRESH_EVENT,update)
  },[open,load])
  const checkOrder=async(id:string)=>{
    if (!isCurrentOwner()) return
    setBusy(id)
    try {
      const order=await getCreditOrder(id,owner)
      if (!isCurrentOwner()) return
      setOrders(items=>items.map(item=>item.id===id ? order : item))
      if(order.status === 'paid') { await refreshBillingBalance(owner); if(isCurrentOwner()) onPaid() }
      if (!isCurrentOwner()) return
      setError(undefined)
    } catch(cause) { if(isCurrentOwner()) setError(cause instanceof Error ? cause.message : '订单查询失败') }
    finally {if(isCurrentOwner()) setBusy(undefined)}
  }
  const purchase=async(pack:NonNullable<BillingCatalog['packs'][number]>,discount?:CreditDiscount)=>{
    if(!isCurrentOwner() || !catalog || !pack.providers.includes(provider) || catalog.paymentBlocked || busy) return
    setBusy(pack.id); setError(undefined)
    try {
      const args = [pack.id,provider,crypto.randomUUID(),owner,pack.amount,catalog.currency] as const
      const order=await (discount ? checkoutCredits(...args,{discountCode:discount.code,expectedPayableAmount:discount.payableAmount}) : checkoutCredits(...args))
      if(!isCurrentOwner()) return
      setOrders(items=>[order,...items.filter(item=>item.id!==order.id)])
      if(order.checkoutUrl) window.location.assign(order.checkoutUrl)
      else setError('支付链接尚未确认，请在充值订单中查询状态')
    } catch(cause) {
      if(isCurrentOwner() && !discount) setError(cause instanceof Error ? cause.message : '充值订单创建失败')
      throw cause
    }
    finally {if(isCurrentOwner()) setBusy(undefined)}
  }
  return <Space direction="vertical" size={12} style={{width:'100%',marginBottom:24}}>
    <span>一次购买，按需使用。充值积分长期有效，新账号赠送 100 积分。</span>
    {error ? <Alert type="error" message={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>} /> : null}
    {!catalog ? <span>正在加载充值套餐…</span> : <>
      <span>支付币种：{catalog.currency==='USD' ? '美元（USD）' : '人民币（CNY）'}</span>
      {catalog.providers.length>1 ? <Select aria-label="付款方式" value={provider} onChange={setProvider} style={{ width: '100%' }} options={catalog.providers.map(value=>({value,label:PROVIDER_LABELS[value]}))} />
        : catalog.providers.length===1 ? <span>付款方式：{PROVIDER_LABELS[catalog.providers[0]]}</span> : null}
      {!catalog.providers.length ? <Alert type="info" message="充值尚未开放，当前可使用已有积分" /> : null}
      {catalog.paymentBlocked ? <Alert type="warning" message="账户存在待核对的支付记录，请联系支持" /> : null}
      <CreditPackPurchase key={JSON.stringify([owner,open,catalog.currency,catalog.packs,catalog.providers])}
        owner={owner} catalog={catalog} provider={provider} providerLabel={PROVIDER_LABELS[provider]} busy={busy}
        expanded={discountExpanded} onExpand={()=>setDiscountExpanded(true)} onPurchase={purchase} />
      <BillingExplanation freeBgRemoveRemaining={catalog.freeBgRemoveRemaining} freeBgRemoveMonth={catalog.freeBgRemoveMonth} />
      <small>现金退款需人工审核，仅处理未使用部分，按原支付通道退款；赠送积分不折现。生成失败自动退积分。</small>
    </>}
    {orders.length ? <><strong>充值订单</strong>{orders.map(order=><div key={order.id} style={{padding:'8px 0',borderBottom:'1px solid var(--color-border)'}}>
      <span>{order.paidAmount == null && order.quotedDiscount ? '预计 ' : ''}{formatCreditPrice(order.paidAmount ?? order.quotedAmount ?? order.amount,order.currency)} · {order.credits} 分 · {STATUS_LABELS[order.status]}</span>
      {(order.paidAmount != null ? order.paidDiscount : order.quotedDiscount) ? <small style={{display:'block'}}>原价 {formatCreditPrice(order.amount,order.currency)} · 折扣代码 {(order.paidAmount != null ? order.paidDiscount : order.quotedDiscount)?.code}</small> : null}
      <small style={{display:'block'}}>{new Date(order.createdAt).toLocaleString('zh-CN')} · {PROVIDER_LABELS[order.provider]}</small>
      <Space>{order.status === 'pending' ? <><Button size="small" loading={busy===order.id} onClick={()=>void checkOrder(order.id)}>查询到账</Button>{order.checkoutUrl ? <Button size="small" onClick={()=>window.location.assign(order.checkoutUrl!)}>继续支付</Button> : null}</> : null}
        {order.status === 'paid' ? <Button size="small" disabled={order.refundRequested} onClick={()=>{setRefundOrder(order);setRefundReason('')}}>{order.refundRequested ? '退款申请已提交' : '申请退款'}</Button> : null}</Space>
    </div>)}</> : null}
    <Modal open={Boolean(refundOrder)} title="申请现金退款" okText="提交人工审核" cancelText="取消" okButtonProps={{disabled:!refundReason.trim()}} confirmLoading={busy==='refund'} onCancel={()=>setRefundOrder(undefined)}
      onOk={()=>void(async()=>{
        if(!refundOrder || !isCurrentOwner() || !refundReason.trim()) return
        setBusy('refund')
        try {
          const next=await requestCashRefund(refundOrder.id,refundReason.trim(),owner)
          if(!isCurrentOwner()) return
          setOrders(items=>items.map(item=>item.id===next.id ? next : item));setRefundOrder(undefined)
        } catch(cause) {if(isCurrentOwner()) setError(cause instanceof Error ? cause.message : '退款申请失败')}
        finally {if(isCurrentOwner()) setBusy(undefined)}
      })()}>
      <p>申请提交后由人工核对未使用积分和可退金额，审核通过后原路退款。</p>
      {error ? <Alert type="error" message={error} /> : null}
      <Input.TextArea aria-label="退款原因" value={refundReason} onChange={event=>setRefundReason(event.target.value)} maxLength={500} placeholder="请填写退款原因" />
    </Modal>
  </Space>
}
