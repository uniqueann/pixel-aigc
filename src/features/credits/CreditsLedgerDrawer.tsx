import { Button, Drawer, Image, Segmented, Space, Tabs } from 'antd'
import { DownloadOutlined, EyeOutlined, FileTextOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import EmptyState from '@/components/EmptyState'
import { listCreditLedger, type CreditLedgerItem, type CreditLedgerPage } from '@/services/api/credits'
import { useUserStore } from '@/store/useUserStore'
import RechargePanel from './RechargePanel'
import { BILLING_REFRESH_EVENT, recoverSyncResult } from '@/services/api/billing'

type LedgerFilter = 'all' | 'expense' | 'income' | 'refund'

const FILTER_OPTIONS: { label: string; value: LedgerFilter }[] = [
  { label: '全部', value: 'all' },
  { label: '消耗扣费', value: 'expense' },
  { label: '充值赠送', value: 'income' },
  { label: '失败退款', value: 'refund' },
]

function filterLedgerItem(item: CreditLedgerItem, filter: LedgerFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'expense') {
    return item.delta < 0 || (item.delta === 0 && item.kind === 'settle')
  }
  if (filter === 'income') {
    return item.delta > 0 && item.kind !== 'refund'
  }
  if (filter === 'refund') {
    return item.kind === 'refund' || item.label.includes('退款') || (item.reason?.includes('退款') ?? false)
  }
  return true
}

function formatLedgerTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN')
}

function LedgerRow({ item }: { item: CreditLedgerItem }) {
  const positive = item.delta > 0
  const owner = useUserStore(state => state.userId ?? state.account?.userId)
  const [recovering, setRecovering] = useState(false)
  const [recovery, setRecovery] = useState<string>()
  const [resultUrl, setResultUrl] = useState<string>()

  const handleRecover = () => {
    if (!item.syncRequestId || !owner) return
    setRecovering(true)
    recoverSyncResult(item.syncRequestId, owner)
      .then(result => {
        const currentUserId = useUserStore.getState().userId ?? useUserStore.getState().account?.userId
        if (currentUserId !== owner) return
        setResultUrl(result.result?.url)
        setRecovery(
          result.state === 'reserved'
            ? '仍在处理中，稍后可再次查询'
            : result.state === 'refunded'
              ? '已失败或超时，积分已退回'
              : '结果已找回，临时保留 7 天'
        )
      })
      .catch(error => {
        setRecovery(error instanceof Error ? error.message : '结果查询失败')
      })
      .finally(() => {
        setRecovering(false)
      })
  }

  const handleDownload = async (url: string) => {
    try {
      const res = await fetch(url)
      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = `result-${item.id}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
    } catch {
      window.open(url, '_blank')
    }
  }

  return (
    <li className="credits-ledger-row">
      <div className="credits-ledger-row-main">
        <div className="credits-ledger-row-title-line">
          <strong>{item.label}</strong>
          {item.summary ? <span className="credits-ledger-summary">{item.summary}</span> : null}
        </div>
        {item.reason ? <small className="credits-ledger-reason">{item.reason}</small> : null}
        {item.syncRequestId && owner ? (
          <div className="credits-ledger-recovery-action">
            <Button
              size="small"
              loading={recovering}
              onClick={handleRecover}
            >
              查询已有结果
            </Button>
          </div>
        ) : null}
        {resultUrl ? (
          <div className="credits-recovery-box">
            <Image
              width={52}
              height={52}
              src={resultUrl}
              alt="生成结果预览"
              className="credits-recovery-thumbnail"
              preview={{ mask: <EyeOutlined /> }}
            />
            <div className="credits-recovery-info">
              <span className="credits-recovery-title">结果已找回</span>
              <small className="credits-recovery-tip">临时保留 7 天</small>
              <div className="credits-recovery-links">
                <Button
                  size="small"
                  type="link"
                  aria-label="下载"
                  icon={<DownloadOutlined />}
                  onClick={() => void handleDownload(resultUrl)}
                  style={{ padding: 0, height: 'auto', fontSize: 12 }}
                >
                  下载
                </Button>
                <a
                  href={resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="credits-recovery-external-link"
                >
                  打开结果图片 ↗
                </a>
              </div>
            </div>
          </div>
        ) : recovery ? (
          <small className="credits-recovery-status">{recovery}</small>
        ) : null}
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
  initialTab = 'ledger',
}: {
  open: boolean
  onClose: () => void
  initialTab?: 'ledger' | 'recharge'
}) {
  const credits = useUserStore(state => state.credits)
  const owner = useUserStore(state => state.userId)
  const version = useRef(0)
  const invalidate = useCallback(() => { version.current++ }, [])
  const [page, setPage] = useState<CreditLedgerPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string>()
  const [activeTab, setActiveTab] = useState<'ledger' | 'recharge'>(initialTab)
  const [filter, setFilter] = useState<LedgerFilter>('all')
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevInitialTab, setPrevInitialTab] = useState(initialTab)

  if (open !== prevOpen || initialTab !== prevInitialTab) {
    setPrevOpen(open)
    setPrevInitialTab(initialTab)
    if (open) {
      setActiveTab(initialTab)
      setFilter('all')
    }
  }

  const load = useCallback(async (cursor?: string) => {
    const current = ++version.current
    if (cursor) setLoadingMore(true)
    else setLoading(true)
    setError(undefined)
    try {
      const next = await listCreditLedger(cursor)
      if (current !== version.current || useUserStore.getState().userId !== owner) return
      useUserStore.getState().setCredits(next.balance)
      setPage(current => cursor
        ? { ...next, items: [...(current?.items ?? []), ...next.items] }
        : next)
    } catch (cause) {
      if (current === version.current) setError(cause instanceof Error ? cause.message : '积分明细加载失败')
    } finally {
      if (current === version.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [owner])

  useEffect(() => {
    let active = true
    queueMicrotask(() => { if (active && open) void load() })
    return () => { active = false; invalidate() }
  }, [owner, open, load, invalidate])

  useEffect(() => {
    if (!open) return
    const update = () => void load()
    window.addEventListener(BILLING_REFRESH_EVENT, update)
    return () => window.removeEventListener(BILLING_REFRESH_EVENT, update)
  }, [open, load])

  const items = page?.items
  const filteredItems = useMemo(() => {
    if (!items) return []
    return items.filter(item => filterLedgerItem(item, filter))
  }, [items, filter])

  const tabItems = [
    {
      key: 'ledger',
      label: (
        <span className="credits-tab-label">
          <FileTextOutlined style={{ marginRight: 6 }} />
          积分明细
        </span>
      ),
      children: (
        <div className="credits-ledger-tab-pane">
          {error ? <p className="credits-ledger-error">{error}</p> : null}
          {loading && !page ? <p className="credits-ledger-hint">正在加载积分流水…</p> : null}
          {page ? (
            <>
              <div className="credits-ledger-filter-bar">
                <Segmented
                  block
                  value={filter}
                  onChange={val => setFilter(val as LedgerFilter)}
                  options={FILTER_OPTIONS}
                />
              </div>
              {page.items.length === 0 ? (
                <EmptyState description="还没有积分流水" />
              ) : filteredItems.length === 0 ? (
                <EmptyState description="暂无该分类的明细记录" />
              ) : (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <ol className="credits-ledger-list">
                    {filteredItems.map(item => <LedgerRow key={item.id} item={item} />)}
                  </ol>
                  {page.nextCursor ? (
                    <Button block loading={loadingMore} onClick={() => void load(page.nextCursor ?? undefined)}>
                      加载更多
                    </Button>
                  ) : (
                    <p className="credits-ledger-hint">已经到底了</p>
                  )}
                </Space>
              )}
            </>
          ) : null}
        </div>
      ),
    },
    {
      key: 'recharge',
      label: (
        <span className="credits-tab-label">
          <ThunderboltOutlined style={{ marginRight: 6 }} />
          充值与套餐
        </span>
      ),
      children: (
        <div className="credits-recharge-tab-pane">
          {open ? (
            <RechargePanel
              key={owner}
              open={open}
              onPaid={() => {
                void load()
                setActiveTab('ledger')
              }}
            />
          ) : null}
        </div>
      ),
    },
  ]

  return (
    <Drawer
      title={`购买积分 · 余额 ${page?.balance ?? credits}`}
      placement="right"
      width="min(440px, 100vw)"
      open={open}
      onClose={onClose}
      className="credits-ledger-drawer"
      rootClassName="credits-ledger-drawer"
    >
      <div className="credits-drawer-summary-card">
        <div className="credits-drawer-balance-box">
          <span className="credits-drawer-balance-label">可用积分余额</span>
          <div className="credits-drawer-balance-value">
            <span className="credits-drawer-balance-num">{page?.balance ?? credits}</span>
            <span className="credits-drawer-balance-unit">分</span>
          </div>
        </div>
        <Button
          type={activeTab === 'recharge' ? 'default' : 'primary'}
          onClick={() => setActiveTab(activeTab === 'recharge' ? 'ledger' : 'recharge')}
        >
          {activeTab === 'recharge' ? '查看明细' : '立即充值'}
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={key => setActiveTab(key as 'ledger' | 'recharge')}
        items={tabItems}
        className="credits-ledger-tabs"
      />
    </Drawer>
  )
}

