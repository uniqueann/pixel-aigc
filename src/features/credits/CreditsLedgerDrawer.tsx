import { Button, Drawer, Space } from 'antd'
import { useCallback, useState } from 'react'
import EmptyState from '@/components/EmptyState'
import { listCreditLedger, type CreditLedgerItem, type CreditLedgerPage } from '@/services/api/credits'
import { useUserStore } from '@/store/useUserStore'

function formatLedgerTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function LedgerRow({ item }: { item: CreditLedgerItem }) {
  const positive = item.delta > 0
  return (
    <li className="credits-ledger-row">
      <div className="credits-ledger-row-main">
        <strong>{item.label}</strong>
        {item.summary ? <span>{item.summary}</span> : null}
        {item.reason ? <small>{item.reason}</small> : null}
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
  const [page, setPage] = useState<CreditLedgerPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()

  const load = useCallback(async (cursor?: string) => {
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(undefined)
    try {
      const next = await listCreditLedger(cursor)
      useUserStore.getState().setCredits(next.balance)
      setPage(current => cursor
        ? { ...next, items: [...(current?.items ?? []), ...next.items] }
        : next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '积分明细加载失败')
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
  }, [])

  return (
    <Drawer
      title={`积分明细 · 余额 ${page?.balance ?? credits}`}
      placement="right"
      width={420}
      open={open}
      afterOpenChange={visible => {
        if (visible) void load()
        else {
          setPage(null)
          setError(undefined)
        }
      }}
      onClose={onClose}
      className="credits-ledger-drawer"
    >
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
