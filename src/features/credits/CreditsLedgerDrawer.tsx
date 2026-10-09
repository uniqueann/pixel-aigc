import { Button, Drawer, Space } from 'antd'
import { useCallback, useEffect, useRef, useState } from 'react'
import EmptyState from '@/components/EmptyState'
import { listCreditLedger, type CreditLedgerItem, type CreditLedgerPage } from '@/services/api/credits'
import { useUserStore } from '@/store/useUserStore'
import RechargePanel from './RechargePanel'
import { BILLING_REFRESH_EVENT, recoverSyncResult } from '@/services/api/billing'

function formatLedgerTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function LedgerRow({ item }: { item: CreditLedgerItem }) {
  const positive = item.delta > 0
  const owner=useUserStore(state=>state.userId)
  const [recovery,setRecovery]=useState<string>()
  const [resultUrl,setResultUrl]=useState<string>()
  return (
    <li className="credits-ledger-row">
      <div className="credits-ledger-row-main">
        <strong>{item.label}</strong>
        {item.summary ? <span>{item.summary}</span> : null}
        {item.reason ? <small>{item.reason}</small> : null}
        {item.syncRequestId && owner ? <Button size="small" onClick={()=>void recoverSyncResult(item.syncRequestId!,owner).then(result=>{
          if(useUserStore.getState().userId!==owner) return
          setResultUrl(result.result?.url);setRecovery(result.state==='reserved' ? '仍在处理中，稍后可再次查询' : result.state==='refunded' ? '已失败或超时，积分已退回' : '结果已保存，临时结果保留 7 天')
        }).catch(error=>setRecovery(error instanceof Error ? error.message : '结果查询失败'))}>查询已有结果</Button> : null}
        {recovery ? <small>{recovery}</small> : null}
        {resultUrl ? <a href={resultUrl} target="_blank" rel="noreferrer">打开结果图片</a> : null}
        <time dateTime={item.createdAt}>{formatLedgerTime(item.createdAt)}</time>
      </div>
      <div className="credits-ledger-row-amounts">
        <span className={positive ? 'is-plus' : item.delta < 0 ? 'is-minus' : undefined}>{item.deltaText}</span>
        <small>余额 {item.balanceAfter}</small>
      </div>
    </li>
  )
}

export default function CreditsLedgerDrawer({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const credits = useUserStore(state => state.credits)
  const owner=useUserStore(state=>state.userId)
  const version=useRef(0)
  const invalidate=useCallback(()=>{version.current++},[])
  const [page, setPage] = useState<CreditLedgerPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async (cursor?: string) => {
    const current=++version.current
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(undefined)
    try {
      const next = await listCreditLedger(cursor)
      if(current!==version.current || useUserStore.getState().userId!==owner) return
      useUserStore.getState().setCredits(next.balance)
      setPage(current => cursor
        ? { ...next, items: [...(current?.items ?? []), ...next.items] }
        : next)
    } catch (cause) {
      if(current===version.current) setError(cause instanceof Error ? cause.message : '积分明细加载失败')
    } finally {
      if(current===version.current) {setLoading(false);setLoadingMore(false)}
    }
  }, [owner])
  useEffect(()=>{
    let active=true
    queueMicrotask(()=>{if(active && open) void load()})
    return()=>{active=false;invalidate()}
  },[owner,open,load,invalidate])
  useEffect(()=>{
    if(!open) return
    const update=()=>void load()
    window.addEventListener(BILLING_REFRESH_EVENT,update)
    return()=>window.removeEventListener(BILLING_REFRESH_EVENT,update)
  },[open,load])

  return (
    <Drawer
      title={`购买积分 · 余额 ${page?.balance ?? credits}`}
      placement="right"
      width="min(420px, 100vw)"
      open={open}
      onClose={onClose}
      className="credits-ledger-drawer"
      rootClassName="credits-ledger-drawer"
    >
      {open ? <RechargePanel key={owner} open={open} onPaid={()=>void load()} /> : null}
      {error ? <p className="credits-ledger-error">{error}</p> : null}
      {loading && !page ? <p className="credits-ledger-hint">正在加载积分流水…</p> : null}
      {page && page.items.length === 0 ? <EmptyState description="还没有积分流水" /> : null}
      {page && page.items.length > 0 ? (
        <Space direction="vertical" size={16} style={{ width: '100%' }}>
          <ol className="credits-ledger-list">
            {page.items.map(item => <LedgerRow key={item.id} item={item} />)}
          </ol>
          {page.nextCursor ? (
            <Button block loading={loadingMore} onClick={() => void load(page.nextCursor ?? undefined)}>
              加载更多
            </Button>
          ) : (
            <p className="credits-ledger-hint">已经到底了</p>
          )}
        </Space>
      ) : null}
    </Drawer>
  )
}
