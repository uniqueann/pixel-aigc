import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Modal, Select, Space } from 'antd'
import { useUserStore } from '@/store/useUserStore'
import { BILLING_REFRESH_EVENT, checkoutCredits, getBillingCatalog, getCreditOrder, listCreditOrders, refreshBillingBalance, requestCashRefund } from '@/services/api/billing'
import { formatCreditPrice, type BillingCatalog, type CreditOrder, type PaymentProvider } from '@shared/billing'
import BillingExplanation from './BillingExplanation'

const STATUS_LABELS = {pending:'等待支付确认',paid:'已到账',failed:'支付失败',refunded:'已退款',review:'待人工核对'}
export default function RechargePanel({open,onPaid}:{open:boolean;onPaid:()=>void}) {
  const owner=useUserStore(state=>state.userId)
  const [catalog,setCatalog]=useState<BillingCatalog>()
  const [orders,setOrders]=useState<CreditOrder[]>([])
  const [provider,setProvider]=useState<PaymentProvider>('creem')
  const [busy,setBusy]=useState<string>()
  const [error,setError]=useState<string>()
  const [refundOrder,setRefundOrder]=useState<CreditOrder>()
  const [refundReason,setRefundReason]=useState('')
  const version=useRef(0)
  const invalidate=useCallback(()=>{version.current++},[])
  const load=useCallback(async()=>{
    if (!owner) return
    const current=++version.current
    try {
      const [next,history]=await Promise.all([getBillingCatalog(owner),listCreditOrders(owner)])
      if (current!==version.current || useUserStore.getState().userId!==owner) return
      setCatalog(next); setOrders(history.items); setProvider(value=>next.providers.includes(value) ? value : next.providers[0] ?? 'creem')
      useUserStore.getState().setCredits(next.balance); setError(undefined)
    } catch(cause) { if(current===version.current) setError(cause instanceof Error ? cause.message : '充值信息加载失败') }
  },[owner])
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
    if (!owner) return
    setBusy(id)
    try {
      const order=await getCreditOrder(id,owner)
      if (useUserStore.getState().userId!==owner) return
      setOrders(items=>items.map(item=>item.id===id ? order : item))
      if(order.status === 'paid') { await refreshBillingBalance(owner); onPaid() }
      setError(undefined)
    } catch(cause) { if(useUserStore.getState().userId===owner) setError(cause instanceof Error ? cause.message : '订单查询失败') }
    finally {setBusy(undefined)}
  }
  const purchase=async(pack:NonNullable<BillingCatalog['packs'][number]>)=>{
    if(!owner || !catalog) return
    setBusy(pack.id); setError(undefined)
    try {
      const order=await checkoutCredits(pack.id,provider,crypto.randomUUID(),owner,pack.amount,catalog.currency)
      if(useUserStore.getState().userId!==owner) return
      if(order.checkoutUrl) window.location.assign(order.checkoutUrl)
    } catch(cause) { if(useUserStore.getState().userId===owner) setError(cause instanceof Error ? cause.message : '充值订单创建失败') }
    finally {setBusy(undefined)}
  }
  return <Space direction="vertical" size={12} style={{width:'100%',marginBottom:24}}>
    <strong>购买积分</strong>
    <span>一次购买，按需使用。充值积分长期有效，新账号赠送 30 积分。</span>
    {error ? <Alert type="error" message={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>} /> : null}
    {!catalog ? <span>正在加载充值套餐…</span> : <>
      {catalog.providers.length>1 ? <Select value={provider} onChange={setProvider} options={catalog.providers.map(value=>({value,label:value === 'creem' ? 'Creem' : 'Dodo Payments'}))} /> : null}
      {!catalog.providers.length ? <Alert type="info" message="充值尚未开放，当前可使用已有积分" /> : null}
      {catalog.paymentBlocked ? <Alert type="warning" message="账户存在待核对的支付记录，请联系支持" /> : null}
      {catalog.packs.map(pack=><div key={pack.id} style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:12,border:'1px solid var(--color-border)',borderRadius:8,padding:12}}>
        <span><strong>{pack.name} · {pack.credits} 积分</strong><br/>{formatCreditPrice(pack.amount,catalog.currency)}</span>
        <Button type="primary" disabled={!pack.providers.includes(provider) || catalog.paymentBlocked || Boolean(busy)} loading={busy===pack.id} onClick={()=>void purchase(pack)}>购买</Button>
      </div>)}
      <BillingExplanation freeBgRemoveRemaining={catalog.freeBgRemoveRemaining} freeBgRemoveMonth={catalog.freeBgRemoveMonth} />
      <small>现金退款需人工审核，仅处理未使用部分，按原支付通道退款；赠送积分不折现。生成失败自动退积分。</small>
    </>}
    {orders.length ? <><strong>充值订单</strong>{orders.map(order=><div key={order.id} style={{padding:'8px 0',borderBottom:'1px solid var(--color-border)'}}>
      <span>{formatCreditPrice(order.amount,order.currency)} · {order.credits} 分 · {STATUS_LABELS[order.status]}</span>
      <small style={{display:'block'}}>{new Date(order.createdAt).toLocaleString('zh-CN')} · {order.provider === 'creem' ? 'Creem' : 'Dodo Payments'}</small>
      <Space>{order.status === 'pending' ? <><Button size="small" loading={busy===order.id} onClick={()=>void checkOrder(order.id)}>查询到账</Button>{order.checkoutUrl ? <Button size="small" onClick={()=>window.location.assign(order.checkoutUrl!)}>继续支付</Button> : null}</> : null}
        {order.status === 'paid' ? <Button size="small" disabled={order.refundRequested} onClick={()=>{setRefundOrder(order);setRefundReason('')}}>{order.refundRequested ? '退款申请已提交' : '申请退款'}</Button> : null}</Space>
    </div>)}</> : null}
    <Modal open={Boolean(refundOrder)} title="申请现金退款" okText="提交人工审核" cancelText="取消" okButtonProps={{disabled:!refundReason.trim()}} confirmLoading={busy==='refund'} onCancel={()=>setRefundOrder(undefined)}
      onOk={()=>void(async()=>{
        if(!refundOrder || !owner || !refundReason.trim()) return
        setBusy('refund')
        try {
          const next=await requestCashRefund(refundOrder.id,refundReason.trim(),owner)
          if(useUserStore.getState().userId!==owner) return
          setOrders(items=>items.map(item=>item.id===next.id ? next : item));setRefundOrder(undefined)
        } catch(cause) {if(useUserStore.getState().userId===owner) setError(cause instanceof Error ? cause.message : '退款申请失败')}
        finally {setBusy(undefined)}
      })()}>
      <p>申请提交后由人工核对未使用积分和可退金额，审核通过后原路退款。</p>
      {error ? <Alert type="error" message={error} /> : null}
      <Input.TextArea aria-label="退款原因" value={refundReason} onChange={event=>setRefundReason(event.target.value)} maxLength={500} placeholder="请填写退款原因" />
    </Modal>
  </Space>
}
