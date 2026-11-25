import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Dropdown, Modal, Skeleton, Spin, Tag, type MenuProps } from 'antd'
import {
  ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, CopyOutlined, DeleteOutlined,
  InboxOutlined, MoreOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, RollbackOutlined, WarningOutlined,
} from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { i18n } from '@/i18n'
import { formatShortDateTime } from '@/i18n/format'
import { useUserStore } from '@/store/useUserStore'
import type { SuiteActor, SuiteProject } from '@shared/ecommerce-suite'
import type { SuiteProjectList } from '@shared/ecommerce-suite-runtime'
import { suiteClient, type SuiteClient } from '@/features/ecommerce-suite/api'
import { copySuite } from '@/features/ecommerce-suite/copy'
import { formatSuiteError, suiteCategoryLabel, suitePlatformLabel } from '@/features/ecommerce-suite/i18n'
import CreateSuite from '@/features/ecommerce-suite/CreateSuite'
import SuiteWorkspace from '@/features/ecommerce-suite/SuiteWorkspace'
import RecoveryImport from '@/features/ecommerce-suite/RecoveryImport'
import './style.css'

type SuiteListItem = SuiteProjectList['items'][number]

const RETENTION_MS = 7 * 86400000

/** 回收站卡片只在这里计算一次保留期，避免渲染时反复解析时间。 */
function retentionInfo(project: SuiteProject, observedAt: number) {
  if (!project.deletedAt) return { expired: false, urgent: false, label: '' }
  const expiresAt = Date.parse(project.deletedAt) + RETENTION_MS
  if (!Number.isFinite(expiresAt)) return { expired: false, urgent: false, label: i18n.t('ecommerce:list.retentionUnknown') }
  const expired = observedAt >= expiresAt
  const urgent = !expired && expiresAt - observedAt < 86400000
  const date = formatShortDateTime(new Date(expiresAt).toISOString())
  return {
    expired,
    urgent,
    label: expired
      ? i18n.t('ecommerce:list.retentionExpired')
      : urgent
        ? i18n.t('ecommerce:list.retentionUntilUrgent', { date })
        : i18n.t('ecommerce:list.retentionUntil', { date }),
  }
}

function SuiteProjectCard({ item, deleted, observedAt, busy, onOpen, onCopy, onRecycle, onRestore }: {
  item: SuiteListItem
  deleted: boolean
  observedAt: number
  busy: boolean
  onOpen: () => void
  onCopy: () => void
  onRecycle: () => void
  onRestore: () => void
}) {
  const { t } = useTranslation('ecommerce')
  const { project, readySlots, enabledSlots, baseReady } = item
  const title = project.config.title
  const retention = deleted ? retentionInfo(project, observedAt) : undefined
  const menuItems: MenuProps['items'] = [
    {
      key: 'copy',
      icon: <CopyOutlined />,
      disabled: busy || !baseReady,
      label: baseReady ? t('list.copyConfig') : t('list.copyConfigNeedsBase'),
    },
    { type: 'divider' },
    { key: 'recycle', danger: true, icon: <DeleteOutlined />, disabled: busy, label: t('list.moveToTrash') },
  ]
  return <article className="suite-card" role="listitem">
    <div className="suite-card-tags">
      <Tag className={`suite-tag${project.config.platform === 'amazon' ? ' is-platform' : ''}`}>
        {suitePlatformLabel(project.config.platform)}
      </Tag>
      <Tag className="suite-tag">{suiteCategoryLabel(project.config.subcategory)}</Tag>
    </div>
    <h2 className="suite-card-title"><Link to={`/ecommerce/${project.id}`} title={title}>{title}</Link></h2>
    <div className="suite-card-progress">
      <div className="suite-card-progress-label"><span>{t('list.imageProgress')}</span><strong>{readySlots} / {enabledSlots}</strong></div>
      {enabledSlots > 0 ? <div
        className="suite-slot-track"
        role="progressbar"
        aria-label={t('list.progressAria', { title })}
        aria-valuemin={0}
        aria-valuemax={enabledSlots}
        aria-valuenow={readySlots}
        aria-valuetext={t('list.progressValueText', { ready: readySlots, total: enabledSlots })}
      >
        {Array.from({ length: enabledSlots }, (_, index) => <span key={index} className={index < readySlots ? 'is-ready' : ''} />)}
      </div> : <p className="suite-card-no-slots">{t('list.noSlotsEnabled')}</p>}
    </div>
    <div className="suite-card-meta">
      {baseReady
        ? <span className="suite-card-status"><CheckCircleOutlined aria-hidden="true" />{t('list.baseUploaded')}</span>
        : <span className="suite-card-status is-warning"><WarningOutlined aria-hidden="true" />{t('list.basePending')}</span>}
      <time dateTime={project.updatedAt}>{t('list.updatedAt', { time: formatShortDateTime(project.updatedAt) })}</time>
    </div>
    {retention && <p className={`suite-card-retention${retention.expired ? ' is-expired' : retention.urgent ? ' is-urgent' : ''}`}>
      <ClockCircleOutlined aria-hidden="true" />{retention.label}
    </p>}
    <div className="suite-card-actions">
      {deleted ? <Button type="primary" icon={<RollbackOutlined />} aria-label={t('list.restoreProject')} disabled={busy || retention?.expired} onClick={onRestore}>
        {t('list.restoreProject')}
      </Button> : <>
        <Button type="primary" onClick={onOpen}>{baseReady ? t('list.openProject') : t('list.uploadBaseImage')}</Button>
        <Dropdown
          trigger={['click']}
          overlayClassName="suite-card-menu"
          menu={{
            items: menuItems,
            onClick: ({ key }) => { if (key === 'copy') onCopy(); if (key === 'recycle') onRecycle() },
          }}
        >
          <Button className="suite-card-more" icon={<MoreOutlined />} aria-label={t('list.moreActionsAria', { title })} aria-haspopup="menu" disabled={busy} />
        </Dropdown>
      </>}
    </div>
  </article>
}

function SuiteListSkeleton() {
  const { t } = useTranslation('ecommerce')
  return <>
    <p className="sr-only" role="status">{t('list.loadingProjects')}</p>
    <div className="suite-list-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <div className="suite-card suite-card-skeleton" key={index}>
        <Skeleton active title={{ width: '58%' }} paragraph={{ rows: 3 }} />
      </div>)}
    </div>
  </>
}

function SuiteListEmpty({ deleted, onCreate }: { deleted: boolean; onCreate: () => void }) {
  const { t } = useTranslation('ecommerce')
  return <div className="suite-empty">
    <span className="suite-empty-icon" aria-hidden="true">{deleted ? <InboxOutlined /> : <PictureOutlined />}</span>
    <h2>{deleted ? t('list.trashEmptyTitle') : t('list.emptyTitle')}</h2>
    <p>{deleted
      ? t('list.trashEmptyDesc')
      : t('list.emptyDesc')}</p>
    {!deleted && <div className="suite-actions">
      <Button type="primary" icon={<PlusOutlined />} aria-label={t('list.createFirstProject')} onClick={onCreate}>{t('list.createFirstProject')}</Button>
    </div>}
  </div>
}

export function SuiteList({ actor, client, signal }: { actor: SuiteActor; client: SuiteClient; signal: AbortSignal }) {
  const { t } = useTranslation(['ecommerce', 'common'])
  const [list, setList] = useState<SuiteProjectList>()
  const [cursor, setCursor] = useState('1')
  const [deleted, setDeleted] = useState(false)
  const [observedAt, setObservedAt] = useState(Date.now)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const requestRef = useRef(0)
  const navigate = useNavigate()
  const { message } = App.useApp()
  const refresh = useCallback(() => {
    const version = ++requestRef.current
    return client.list(cursor, deleted).then(result => {
      // 翻页或切换回收站时，旧请求可能晚到，不能覆盖当前页的数据。
      if (signal.aborted || version !== requestRef.current) return
      setList(result)
      setObservedAt(Date.now())
      setError('')
      setAnnouncement(deleted
        ? i18n.t('ecommerce:list.announcedTrashCount', { count: result.items.length })
        : i18n.t('ecommerce:list.announcedCount', { count: result.items.length }))
    })
  }, [client, cursor, deleted, signal])
  useEffect(() => {
    if (!deleted) return
    const timer = setInterval(() => setObservedAt(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [deleted])
  useEffect(() => {
    void refresh().catch(error => {
      if (signal.aborted) return
      setError(formatSuiteError(error, 'ecommerce:list.loadFailed'))
    })
  }, [refresh, signal])
  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError('')
    try {
      await action()
      client.assertCurrent()
    } catch (error) {
      if (!signal.aborted) {
        setError(formatSuiteError(error, 'ecommerce:errors.actionFailed')); setBusy(false)
      }
      return
    }
    if (success) message.success(success)
    try {
      await refresh()
      if (success) setAnnouncement(success)
    } catch (error) {
      if (!signal.aborted) {
        const text = formatSuiteError(error, 'ecommerce:list.refreshFailed')
        setError(t('ecommerce:list.actionDoneRefreshFailed', { reason: text }))
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }
  const retry = async () => {
    setBusy(true); setError('')
    try { await refresh() }
    catch (error) {
      if (!signal.aborted) {
        setError(formatSuiteError(error, 'ecommerce:list.loadFailed'))
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }
  const goToPage = (next: string) => {
    if (next === cursor) return
    // 立即作废在途请求，避免旧页数据在切页后短暂回填。
    requestRef.current += 1
    setCursor(next)
    setList(undefined)
    setError('')
  }
  const changeMode = (next: boolean) => {
    if (next === deleted) return
    requestRef.current += 1
    setCursor('1')
    setDeleted(next)
    setList(undefined)
    setError('')
    setAnnouncement('')
  }
  const openProject = (id: string) => navigate(`/ecommerce/${id}`)
  const copyProject = (id: string) => { void run(async () => {
    const copy = await copySuite(client, await client.get(id))
    navigate(`/ecommerce/${copy.id}`)
  }, t('ecommerce:list.copySuccess')) }
  const recycleProject = (id: string) => Modal.confirm({
    title: t('ecommerce:list.recycleConfirmTitle'),
    content: t('ecommerce:list.recycleConfirmContent'),
    okText: t('ecommerce:list.moveToTrash'),
    cancelText: t('common:actions.cancel'),
    onOk: () => run(() => client.recycle(id), t('ecommerce:list.recycleSuccess')),
  })
  const restoreProject = (id: string) => { void run(() => client.restore(id), t('ecommerce:list.restoreSuccess')) }
  return <div className="suite-list-page">
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <header className="suite-list-header">
      <div className="suite-list-heading">
        <h1>{deleted ? t('ecommerce:list.trashHeading') : t('ecommerce:title')}</h1>
        <p>{deleted
          ? t('ecommerce:list.trashSubtitle')
          : t('ecommerce:list.subtitle')}</p>
      </div>
      <div className="suite-actions suite-list-header-actions">
        {deleted ? <Button icon={<ArrowLeftOutlined />} aria-label={t('ecommerce:list.backToList')} disabled={busy} onClick={() => changeMode(false)}>{t('ecommerce:list.backToList')}</Button> : <>
          <Button icon={<InboxOutlined />} aria-label={t('ecommerce:list.trashButton')} disabled={busy} onClick={() => changeMode(true)}>{t('ecommerce:list.trashButton')}</Button>
          <RecoveryImport actor={actor} client={client} onImported={id => navigate(`/ecommerce/${id}`)} />
          {!(list && !list.items.length) && <Button type="primary" icon={<PlusOutlined />} aria-label={t('ecommerce:list.createProject')} disabled={busy} onClick={() => setCreating(true)}>{t('ecommerce:list.createProject')}</Button>}
        </>}
      </div>
    </header>
    {error && <Alert
      className="suite-list-error"
      type="error"
      showIcon
      message={list ? t('ecommerce:list.actionIncomplete') : t('ecommerce:list.loadFailed')}
      description={error}
      action={<Button icon={<ReloadOutlined />} aria-label={list ? t('ecommerce:list.refreshList') : t('common:actions.retryLoad')} onClick={() => { void retry() }}>{list ? t('ecommerce:list.refreshList') : t('common:actions.retryLoad')}</Button>}
    />}
    {!list ? (error ? null : <SuiteListSkeleton />) : !list.items.length
      ? <SuiteListEmpty deleted={deleted} onCreate={() => setCreating(true)} />
      : <>
        <div className="suite-list-meta">
          <span>{t('ecommerce:list.pageCount', { count: list.items.length })}</span>
          <div className="suite-list-pagination">
            <Button disabled={busy || cursor === '1'} onClick={() => goToPage(String(Number(cursor) - 1))}>{t('ecommerce:list.prevPage')}</Button>
            <span className="suite-page-indicator" aria-current="page">{t('ecommerce:list.pageIndicator', { page: cursor })}</span>
            <Button disabled={busy || !list.nextCursor} onClick={() => goToPage(list.nextCursor!)}>{t('ecommerce:list.nextPage')}</Button>
          </div>
        </div>
        <div className="suite-list-grid" role="list" aria-busy={busy}>
          {list.items.map(item => <SuiteProjectCard
            key={item.project.id}
            item={item}
            deleted={deleted}
            observedAt={observedAt}
            busy={busy}
            onOpen={() => openProject(item.project.id)}
            onCopy={() => copyProject(item.project.id)}
            onRecycle={() => recycleProject(item.project.id)}
            onRestore={() => restoreProject(item.project.id)}
          />)}
        </div>
      </>}
    {creating && <CreateSuite actor={actor} client={client} onClose={() => setCreating(false)} onCreated={id => navigate(`/ecommerce/${id}`)} />}
  </div>
}

function SuiteSession({ actor }: { actor: SuiteActor }) {
  const { t } = useTranslation('ecommerce')
  const { id } = useParams()
  const [lifetime, setLifetime] = useState<AbortController>()
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) setLifetime(controller) }); return () => controller.abort() }, [])
  const client = useMemo(() => suiteClient(actor, lifetime?.signal), [actor, lifetime])
  if (!lifetime) return <Spin />
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return <Alert type="error" message={t('errors.invalidProjectId')} />
  return id ? <SuiteWorkspace key={id} id={id} actor={actor} client={client} signal={lifetime.signal} /> : <SuiteList actor={actor} client={client} signal={lifetime.signal} />
}
export default function EcommerceSuite() {
  const { t } = useTranslation('ecommerce')
  const userId = useUserStore(state => state.account?.userId)
  const runtimeScope = useUserStore(state => state.account?.runtimeScope)
  const enabled = useUserStore(state => state.account?.features?.ecommerceSuite)
  const actor = useMemo(() => userId && runtimeScope ? { userId, runtimeScope } : null, [userId, runtimeScope])
  if (!actor) return <div className="suite-list-page"><h1 className="sr-only">{t('title')}</h1><Alert type="info" showIcon message={t('auth.signInRequired')} description={t('auth.signInRequiredDesc')} /></div>
  if (!enabled) return <div className="suite-list-page"><h1 className="sr-only">{t('title')}</h1><Alert type="info" showIcon message={t('auth.featureBeta')} /></div>
  return <SuiteSession key={`${actor.userId}:${actor.runtimeScope}`} actor={actor} />
}
