import { Button, Drawer, Image, Segmented, Space, Tabs } from 'antd'
import { DownloadOutlined, EyeOutlined, FileTextOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { creditJobSpec } from '@shared/credits'
import { EMAIL_MODELS } from '@shared/email-models'
import EmptyState from '@/components/EmptyState'
import { i18n } from '@/i18n'
import { translateApiError, translateLegacyDbText } from '@/i18n/apiErrors'
import { activeLocale, formatDateTime } from '@/i18n/format'
import zhCredits from '@/i18n/locales/zh-CN/credits.json'
import { listCreditLedger, type CreditLedgerItem, type CreditLedgerPage } from '@/services/api/credits'
import type { ApiError } from '@/services/api/client'
import { useUserStore } from '@/store/useUserStore'
import RechargePanel from './RechargePanel'
import { BILLING_REFRESH_EVENT, recoverSyncResult } from '@/services/api/billing'

type LedgerFilter = 'all' | 'expense' | 'income' | 'refund'

const CJK_RE = /[\u4e00-\u9fff]/
const EMAIL_OP_KEYS = new Set(['reply', 'summarize', 'polish', 'grammar'])

function filterLedgerItem(item: CreditLedgerItem, filter: LedgerFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'expense') {
    return item.delta < 0 || (item.delta === 0 && item.kind === 'settle')
  }
  if (filter === 'income') {
    return item.delta > 0 && item.kind !== 'refund'
  }
  if (filter === 'refund') {
    return (
      item.kind === 'refund' ||
      item.presentation?.status === 'refunded' ||
      item.presentation?.reasonCode === 'cash_refund_reclaim' ||
      translateLegacyDbText(item.reason) === i18n.t('errors:legacyDb.cashRefundReclaim')
    )
  }
  return true
}

function localizedKindLabel(kind: string, delta: number): string {
  if (kind === 'settle') return delta <= 0 ? i18n.t('credits:ledger.kinds.settle') : i18n.t('credits:ledger.kinds.settleRefund')
  if (kind === 'grant' || kind === 'reserve' || kind === 'refund' || kind === 'adjust') {
    return i18n.t(`credits:ledger.kinds.${kind}`)
  }
  return kind
}

function localizeReason(item: CreditLedgerItem): string | undefined {
  const code = item.presentation?.reasonCode
  if (code === 'initial_grant') return i18n.t('errors:legacyDb.initialGrant')
  if (code === 'top_up') return i18n.t('errors:legacyDb.creditTopUp')
  if (code === 'cash_refund_reclaim') return i18n.t('errors:legacyDb.cashRefundReclaim')
  if (!item.reason) return undefined
  const fallback = code === 'admin_adjust' ? i18n.t('credits:ledger.kinds.adjust') : undefined
  return translateLegacyDbText(item.reason, activeLocale() === 'zh-CN' ? item.reason : fallback)
}

function localizedPresentation(item: CreditLedgerItem): {
  label: string
  summary: string
  deltaText: string
  reason?: string
} {
  const reason = localizeReason(item)
  const p = item.presentation
  if (!p) {
    if (activeLocale() === 'zh-CN') {
      return { label: item.label, summary: item.summary, deltaText: item.deltaText, reason }
    }
    const isFreeCutout = item.label === zhCredits.ledger.freeBgRemove.label
    if (isFreeCutout) {
      return {
        label: i18n.t('credits:ledger.freeBgRemove.label'),
        summary: item.kind === 'refund' ? i18n.t('credits:ledger.freeBgRemove.refundedSummary') : i18n.t('credits:ledger.freeBgRemove.usedSummary'),
        deltaText: i18n.t('credits:ledger.freeBgRemove.deltaText'),
        reason,
      }
    }
    const safeLabel = !CJK_RE.test(item.label) ? item.label : localizedKindLabel(item.kind, item.delta)
    const safeSummary = !CJK_RE.test(item.summary) ? item.summary : ''
    const safeDelta = !CJK_RE.test(item.deltaText) ? item.deltaText : String(item.delta)
    return { label: safeLabel, summary: safeSummary, deltaText: safeDelta, reason }
  }

  if (p.entryType === 'free_bg_remove') {
    return {
      label: i18n.t('credits:ledger.freeBgRemove.label'),
      summary: p.status === 'refunded' ? i18n.t('credits:ledger.freeBgRemove.refundedSummary') : i18n.t('credits:ledger.freeBgRemove.usedSummary'),
      deltaText: i18n.t('credits:ledger.freeBgRemove.deltaText'),
      reason,
    }
  }

  let title = ''
  if (p.entryType === 'email_assist') {
    const opKey = p.operation && EMAIL_OP_KEYS.has(p.operation) ? p.operation : 'default'
    const operation = i18n.t(`credits:ledger.email.ops.${opKey}` as never)
    const model = EMAIL_MODELS.find(entry => entry.id === p.modelProfileId)?.label ?? i18n.t('credits:ledger.email.legacyModel')
    title = i18n.t('credits:ledger.email.title', { operation, model })
  } else if (p.entryType === 'sync_tool') {
    title = p.tool
      ? i18n.t(`credits:syncTools.${p.tool}` as never, { defaultValue: CJK_RE.test(item.title) ? p.tool : item.title })
      : (CJK_RE.test(item.title) ? '' : item.title)
  } else if (p.entryType === 'image_job') {
    const toolLabel = p.tool
      ? i18n.t(`credits:ledger.tools.${p.tool}` as never, { defaultValue: CJK_RE.test(item.title) ? '' : item.title })
      : ''
    if (p.capability === 'text_to_video') {
      const duration = typeof p.durationSeconds === 'number'
        ? i18n.t('credits:ledger.durationSeconds', { seconds: p.durationSeconds })
        : undefined
      title = [toolLabel, p.resolution?.toUpperCase(), duration].filter(Boolean).join(' ')
    } else {
      const spec = creditJobSpec(p.resolution, p.count)
      title = [toolLabel, spec].filter(Boolean).join(' ')
    }
  }

  const isMergedJob = p.entryType === 'image_job' && Boolean(item.title) && item.label === item.title
  if (isMergedJob) {
    let summary = ''
    if (p.status === 'reserved') {
      summary = i18n.t('credits:ledger.status.reserved')
    } else if (p.status === 'refunded') {
      summary = i18n.t('credits:ledger.status.refunded')
    } else if (p.status === 'settled') {
      const charged = item.charged ?? 0
      summary = (p.refunded ?? 0) > 0 && charged > 0
        ? i18n.t('credits:ledger.status.settledWithRefund', { charged, refunded: p.refunded })
        : i18n.t('credits:ledger.status.settled', { charged })
    }
    return {
      label: title || (CJK_RE.test(item.label) ? localizedKindLabel(item.kind, item.delta) : item.label),
      summary: summary || (CJK_RE.test(item.summary) ? '' : item.summary),
      deltaText: item.deltaText,
      reason,
    }
  }

  const extra = item.charged != null && (item.kind === 'settle' || item.kind === 'refund')
    ? i18n.t('credits:ledger.status.settled', { charged: item.charged })
    : ''
  return {
    label: localizedKindLabel(item.kind, item.delta),
    summary: [title, extra].filter(Boolean).join(' '),
    deltaText: item.deltaText,
    reason,
  }
}

function LedgerRow({ item }: { item: CreditLedgerItem }) {
  const { t } = useTranslation(['credits', 'common', 'errors'])
  const positive = item.delta > 0
  const owner = useUserStore(state => state.userId ?? state.account?.userId)
  const [recovering, setRecovering] = useState(false)
  const [recovery, setRecovery] = useState<{ kind: 'reserved' | 'refunded' | 'recovered' | 'expired' | 'raw'; raw?: string }>()
  const [resultUrl, setResultUrl] = useState<string>()
  const display = localizedPresentation(item)

  const handleRecover = () => {
    if (!item.syncRequestId || !owner) return
    setRecovering(true)
    recoverSyncResult(item.syncRequestId, owner)
      .then(result => {
        const currentUserId = useUserStore.getState().userId ?? useUserStore.getState().account?.userId
        if (currentUserId !== owner) return
        if (result.state === 'settled' && (result.resultExpired || !result.result?.url)) {
          setResultUrl(undefined)
          setRecovery({ kind: 'expired' })
          return
        }
        setResultUrl(result.result?.url)
        setRecovery({
          kind: result.state === 'reserved' ? 'reserved' : result.state === 'refunded' ? 'refunded' : 'recovered',
        })
      })
      .catch(cause => {
        const apiError = cause as ApiError | undefined
        setRecovery({
          kind: 'raw',
          raw: translateApiError({
            code: apiError?.code,
            extra: apiError?.extra,
            message: cause instanceof Error ? cause.message : undefined,
            fallback: t('credits:drawer.queryFailed'),
          }),
        })
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

  const recoveryText = recovery
    ? recovery.kind === 'reserved'
      ? t('credits:drawer.queryPending')
      : recovery.kind === 'refunded'
        ? t('credits:drawer.queryRefunded')
        : recovery.kind === 'expired'
          ? t('credits:drawer.queryExpired')
          : recovery.kind === 'recovered'
            ? t('credits:drawer.queryRecovered')
            : recovery.raw
    : undefined

  return (
    <li className="credits-ledger-row">
      <div className="credits-ledger-row-main">
        <div className="credits-ledger-row-title-line">
          <strong>{display.label}</strong>
          {display.summary ? <span className="credits-ledger-summary">{display.summary}</span> : null}
        </div>
        {display.reason ? <small className="credits-ledger-reason">{display.reason}</small> : null}
        {item.syncRequestId && owner && recovery?.kind !== 'expired' && recovery?.kind !== 'refunded' ? (
          <div className="credits-ledger-recovery-action">
            <Button
              size="small"
              loading={recovering}
              onClick={handleRecover}
            >
              {t('credits:drawer.queryResult')}
            </Button>
          </div>
        ) : null}
        {resultUrl ? (
          <div className="credits-recovery-box">
            <Image
              width={52}
              height={52}
              src={resultUrl}
              alt={t('credits:drawer.resultPreviewAlt')}
              className="credits-recovery-thumbnail"
              preview={{ mask: <EyeOutlined /> }}
            />
            <div className="credits-recovery-info">
              <span className="credits-recovery-title">{t('credits:drawer.recoveredTitle')}</span>
              <small className="credits-recovery-tip">{t('credits:drawer.recoveredTip')}</small>
              <div className="credits-recovery-links">
                <Button
                  size="small"
                  type="link"
                  aria-label={t('common:actions.download')}
                  icon={<DownloadOutlined />}
                  onClick={() => void handleDownload(resultUrl)}
                  style={{ padding: 0, height: 'auto', fontSize: 12 }}
                >
                  {t('common:actions.download')}
                </Button>
                <a
                  href={resultUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="credits-recovery-external-link"
                >
                  {t('credits:drawer.openResultImage')}
                </a>
              </div>
            </div>
          </div>
        ) : recoveryText ? (
          <small className="credits-recovery-status">{recoveryText}</small>
        ) : null}
        <time dateTime={item.createdAt}>{formatDateTime(item.createdAt)}</time>
      </div>
      <div className="credits-ledger-row-amounts">
        <span className={positive ? 'is-plus' : item.delta < 0 ? 'is-minus' : undefined}>{display.deltaText}</span>
        <small>{t('credits:drawer.balanceAfter', { balance: item.balanceAfter })}</small>
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
  const { t } = useTranslation(['credits', 'common'])
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
      if (current === version.current) {
        const apiError = cause as ApiError | undefined
        setError(translateApiError({
          code: apiError?.code,
          extra: apiError?.extra,
          message: cause instanceof Error ? cause.message : undefined,
          fallback: t('credits:drawer.loadFailed'),
        }))
      }
    } finally {
      if (current === version.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [owner, t])

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

  const filterOptions: { label: string; value: LedgerFilter }[] = [
    { label: t('credits:drawer.filters.all'), value: 'all' },
    { label: t('credits:drawer.filters.expense'), value: 'expense' },
    { label: t('credits:drawer.filters.income'), value: 'income' },
    { label: t('credits:drawer.filters.refund'), value: 'refund' },
  ]

  const tabItems = [
    {
      key: 'ledger',
      label: (
        <span className="credits-tab-label">
          <FileTextOutlined style={{ marginRight: 6 }} />
          {t('credits:drawer.tabs.ledger')}
        </span>
      ),
      children: (
        <div className="credits-ledger-tab-pane">
          {error ? <p className="credits-ledger-error">{error}</p> : null}
          {loading && !page ? <p className="credits-ledger-hint">{t('credits:drawer.loading')}</p> : null}
          {page ? (
            <>
              <div className="credits-ledger-filter-bar">
                <Segmented
                  block
                  value={filter}
                  onChange={val => setFilter(val as LedgerFilter)}
                  options={filterOptions}
                />
              </div>
              {page.items.length === 0 ? (
                <EmptyState description={t('credits:drawer.emptyAll')} />
              ) : filteredItems.length === 0 ? (
                <EmptyState description={t('credits:drawer.emptyFiltered')} />
              ) : (
                <Space direction="vertical" size={16} style={{ width: '100%' }}>
                  <ol className="credits-ledger-list">
                    {filteredItems.map(item => <LedgerRow key={item.id} item={item} />)}
                  </ol>
                  {page.nextCursor ? (
                    <Button block loading={loadingMore} onClick={() => void load(page.nextCursor ?? undefined)}>
                      {t('common:actions.loadMore')}
                    </Button>
                  ) : (
                    <p className="credits-ledger-hint">{t('credits:drawer.endOfList')}</p>
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
          {t('credits:drawer.tabs.recharge')}
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
      title={t('credits:drawer.title', { balance: page?.balance ?? credits })}
      placement="right"
      width="min(440px, 100vw)"
      open={open}
      onClose={onClose}
      className="credits-ledger-drawer"
      rootClassName="credits-ledger-drawer"
    >
      <div className="credits-drawer-summary-card">
        <div className="credits-drawer-balance-box">
          <span className="credits-drawer-balance-label">{t('credits:drawer.availableBalance')}</span>
          <div className="credits-drawer-balance-value">
            <span className="credits-drawer-balance-num">{page?.balance ?? credits}</span>
            <span className="credits-drawer-balance-unit">{t('credits:drawer.unit')}</span>
          </div>
        </div>
        <Button
          type={activeTab === 'recharge' ? 'default' : 'primary'}
          onClick={() => setActiveTab(activeTab === 'recharge' ? 'ledger' : 'recharge')}
        >
          {activeTab === 'recharge' ? t('credits:drawer.viewLedger') : t('credits:drawer.rechargeNow')}
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

