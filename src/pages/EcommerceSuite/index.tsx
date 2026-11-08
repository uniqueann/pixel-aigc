import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, App, Button, Dropdown, Modal, Skeleton, Spin, Tag, type MenuProps } from 'antd'
import {
  ArrowLeftOutlined, CheckCircleOutlined, ClockCircleOutlined, CopyOutlined, DeleteOutlined,
  InboxOutlined, MoreOutlined, PictureOutlined, PlusOutlined, ReloadOutlined, RollbackOutlined, WarningOutlined,
} from '@ant-design/icons'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'
import { formatShortDateTime } from '@/utils/datetime'
import type { SuiteActor, SuiteProject } from '@shared/ecommerce-suite'
import type { SuiteProjectList } from '@shared/ecommerce-suite-runtime'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { suiteClient, type SuiteClient } from '@/features/ecommerce-suite/api'
import { copySuite } from '@/features/ecommerce-suite/copy'
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
  if (!Number.isFinite(expiresAt)) return { expired: false, urgent: false, label: '保留期未知' }
  const expired = observedAt >= expiresAt
  const urgent = !expired && expiresAt - observedAt < 86400000
  return {
    expired,
    urgent,
    label: expired
      ? '已超过 7 天保留期'
      : `保留至 ${formatShortDateTime(new Date(expiresAt).toISOString())}${urgent ? '（不足 1 天）' : ''}`,
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
  const { project, readySlots, enabledSlots, baseReady } = item
  const title = project.config.title
  const retention = deleted ? retentionInfo(project, observedAt) : undefined
  const menuItems: MenuProps['items'] = [
    {
      key: 'copy',
      icon: <CopyOutlined />,
      disabled: busy || !baseReady,
      label: baseReady ? '复制配置' : '复制配置（需先上传主体图）',
    },
    { type: 'divider' },
    { key: 'recycle', danger: true, icon: <DeleteOutlined />, disabled: busy, label: '移入回收站' },
  ]
  return <article className="suite-card" role="listitem">
    <div className="suite-card-tags">
      <Tag className={`suite-tag${project.config.platform === 'amazon' ? ' is-platform' : ''}`}>
        {project.config.platform === 'amazon' ? 'Amazon 美国站' : '通用模板'}
      </Tag>
      <Tag className="suite-tag">{SUITE_CATEGORY_TEMPLATES[project.config.subcategory].label}</Tag>
    </div>
    <h2 className="suite-card-title"><Link to={`/ecommerce/${project.id}`} title={title}>{title}</Link></h2>
    <div className="suite-card-progress">
      <div className="suite-card-progress-label"><span>图片进度</span><strong>{readySlots} / {enabledSlots}</strong></div>
      {enabledSlots > 0 ? <div
        className="suite-slot-track"
        role="progressbar"
        aria-label={`${title} 的图片槽位就绪进度`}
        aria-valuemin={0}
        aria-valuemax={enabledSlots}
        aria-valuenow={readySlots}
        aria-valuetext={`${readySlots} / ${enabledSlots} 张已就绪`}
      >
        {Array.from({ length: enabledSlots }, (_, index) => <span key={index} className={index < readySlots ? 'is-ready' : ''} />)}
      </div> : <p className="suite-card-no-slots">尚未启用图片槽位</p>}
    </div>
    <div className="suite-card-meta">
      {baseReady
        ? <span className="suite-card-status"><CheckCircleOutlined aria-hidden="true" />主体图已上传</span>
        : <span className="suite-card-status is-warning"><WarningOutlined aria-hidden="true" />待上传主体图</span>}
      <time dateTime={project.updatedAt}>更新于 {formatShortDateTime(project.updatedAt)}</time>
    </div>
    {retention && <p className={`suite-card-retention${retention.expired ? ' is-expired' : retention.urgent ? ' is-urgent' : ''}`}>
      <ClockCircleOutlined aria-hidden="true" />{retention.label}
    </p>}
    <div className="suite-card-actions">
      {deleted ? <Button type="primary" icon={<RollbackOutlined />} aria-label="恢复项目" disabled={busy || retention?.expired} onClick={onRestore}>
        恢复项目
      </Button> : <>
        <Button type="primary" onClick={onOpen}>{baseReady ? '打开项目' : '上传主体图'}</Button>
        <Dropdown
          trigger={['click']}
          overlayClassName="suite-card-menu"
          menu={{
            items: menuItems,
            onClick: ({ key }) => { if (key === 'copy') onCopy(); if (key === 'recycle') onRecycle() },
          }}
        >
          <Button className="suite-card-more" icon={<MoreOutlined />} aria-label={`更多操作：${title}`} aria-haspopup="menu" disabled={busy} />
        </Dropdown>
      </>}
    </div>
  </article>
}

function SuiteListSkeleton() {
  return <>
    <p className="sr-only" role="status">正在加载套图项目…</p>
    <div className="suite-list-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => <div className="suite-card suite-card-skeleton" key={index}>
        <Skeleton active title={{ width: '58%' }} paragraph={{ rows: 3 }} />
      </div>)}
    </div>
  </>
}

function SuiteListEmpty({ deleted, onCreate }: { deleted: boolean; onCreate: () => void }) {
  return <div className="suite-empty">
    <span className="suite-empty-icon" aria-hidden="true">{deleted ? <InboxOutlined /> : <PictureOutlined />}</span>
    <h2>{deleted ? '回收站为空' : '还没有套图项目'}</h2>
    <p>{deleted
      ? '移入回收站的项目会在这里保留 7 天，期间可随时恢复。'
      : '上传一张商品主体图，设置规格与卖点，就能生成整套展示图。'}</p>
    {!deleted && <div className="suite-actions">
      <Button type="primary" icon={<PlusOutlined />} aria-label="新建第一个套图项目" onClick={onCreate}>新建第一个套图项目</Button>
    </div>}
  </div>
}

export function SuiteList({ actor, client, signal }: { actor: SuiteActor; client: SuiteClient; signal: AbortSignal }) {
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
      setAnnouncement(deleted ? `回收站已加载 ${result.items.length} 个项目` : `已加载 ${result.items.length} 个项目`)
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
      setError(error instanceof Error ? error.message : '项目列表读取失败')
    })
  }, [refresh, signal])
  const run = async (action: () => Promise<unknown>, success?: string) => {
    setBusy(true); setError('')
    try {
      await action()
      client.assertCurrent()
    } catch (error) {
      if (!signal.aborted) {
        setError(error instanceof Error ? error.message : '操作失败'); setBusy(false)
      }
      return
    }
    if (success) message.success(success)
    try {
      await refresh()
      if (success) setAnnouncement(success)
    } catch (error) {
      if (!signal.aborted) {
        const text = error instanceof Error ? error.message : '列表刷新失败'
        setError(`操作已完成，但列表刷新失败：${text}`)
      }
    } finally { if (!signal.aborted) setBusy(false) }
  }
  const retry = async () => {
    setBusy(true); setError('')
    try { await refresh() }
    catch (error) {
      if (!signal.aborted) {
        setError(error instanceof Error ? error.message : '项目列表读取失败')
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
  }, '项目配置与图片已成功复制') }
  const recycleProject = (id: string) => Modal.confirm({
    title: '移入回收站？',
    content: '可在回收站保留 7 天；正在生成的图片任务不受影响。',
    okText: '移入回收站',
    cancelText: '取消',
    onOk: () => run(() => client.recycle(id), '项目已移入回收站'),
  })
  const restoreProject = (id: string) => { void run(() => client.restore(id), '项目已恢复') }
  return <div className="suite-list-page">
    <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
    <header className="suite-list-header">
      <div className="suite-list-heading">
        <h1>{deleted ? '回收站' : '电商套图'}</h1>
        <p>{deleted
          ? '移入回收站的项目保留 7 天，期间可随时恢复；正在生成的图片任务不受影响。'
          : '基于真实商品图制作整套电商展示图：设置规格与卖点，生成多槽位场景图，精修后批量导出。'}</p>
      </div>
      <div className="suite-actions suite-list-header-actions">
        {deleted ? <Button icon={<ArrowLeftOutlined />} aria-label="返回项目列表" disabled={busy} onClick={() => changeMode(false)}>返回项目列表</Button> : <>
          <Button icon={<InboxOutlined />} aria-label="回收站" disabled={busy} onClick={() => changeMode(true)}>回收站</Button>
          <RecoveryImport actor={actor} client={client} onImported={id => navigate(`/ecommerce/${id}`)} />
          {!(list && !list.items.length) && <Button type="primary" icon={<PlusOutlined />} aria-label="新建套图项目" disabled={busy} onClick={() => setCreating(true)}>新建套图项目</Button>}
        </>}
      </div>
    </header>
    {error && <Alert
      className="suite-list-error"
      type="error"
      showIcon
      message={list ? '操作未完成' : '项目列表读取失败'}
      description={error}
      action={<Button icon={<ReloadOutlined />} aria-label={list ? '刷新列表' : '重试读取'} onClick={() => { void retry() }}>{list ? '刷新列表' : '重试读取'}</Button>}
    />}
    {!list ? (error ? null : <SuiteListSkeleton />) : !list.items.length
      ? <SuiteListEmpty deleted={deleted} onCreate={() => setCreating(true)} />
      : <>
        <div className="suite-list-meta">
          <span>本页 {list.items.length} 个项目</span>
          <div className="suite-list-pagination">
            <Button disabled={busy || cursor === '1'} onClick={() => goToPage(String(Number(cursor) - 1))}>上一页</Button>
            <span className="suite-page-indicator" aria-current="page">第 {cursor} 页</span>
            <Button disabled={busy || !list.nextCursor} onClick={() => goToPage(list.nextCursor!)}>下一页</Button>
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
  const { id } = useParams()
  const [lifetime, setLifetime] = useState<AbortController>()
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => { if (!controller.signal.aborted) setLifetime(controller) }); return () => controller.abort() }, [])
  const client = useMemo(() => suiteClient(actor, lifetime?.signal), [actor, lifetime])
  if (!lifetime) return <Spin />
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) return <Alert type="error" message="套图项目编号无效" />
  return id ? <SuiteWorkspace key={id} id={id} actor={actor} client={client} signal={lifetime.signal} /> : <SuiteList actor={actor} client={client} signal={lifetime.signal} />
}
export default function EcommerceSuite() {
  const userId = useUserStore(state => state.account?.userId)
  const runtimeScope = useUserStore(state => state.account?.runtimeScope)
  const enabled = useUserStore(state => state.account?.features?.ecommerceSuite)
  const actor = useMemo(() => userId && runtimeScope ? { userId, runtimeScope } : null, [userId, runtimeScope])
  if (!actor) return <div className="suite-list-page"><h1 className="sr-only">电商套图</h1><Alert type="info" showIcon message="请先登录账号" description="登录后即可保存套图项目并使用 AI 批量生成展示图。" /></div>
  if (!enabled) return <div className="suite-list-page"><h1 className="sr-only">电商套图</h1><Alert type="info" showIcon message="电商套图功能正在内测中，敬请期待" /></div>
  return <SuiteSession key={`${actor.userId}:${actor.runtimeScope}`} actor={actor} />
}
