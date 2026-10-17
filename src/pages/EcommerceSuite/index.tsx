import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, App, Button, Empty, Modal, Spin, Tag } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { useUserStore } from '@/store/useUserStore'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { SuiteProjectList } from '@shared/ecommerce-suite-runtime'
import { SUITE_CATEGORY_TEMPLATES } from '@shared/ecommerce-suite-templates'
import { suiteClient, type SuiteClient } from '@/features/ecommerce-suite/api'
import { copySuite } from '@/features/ecommerce-suite/copy'
import CreateSuite from '@/features/ecommerce-suite/CreateSuite'
import SuiteWorkspace from '@/features/ecommerce-suite/SuiteWorkspace'
import RecoveryImport from '@/features/ecommerce-suite/RecoveryImport'
import './style.css'

function SuiteList({ actor, client, signal }: { actor: SuiteActor; client: SuiteClient; signal: AbortSignal }) {
  const [list, setList] = useState<SuiteProjectList>()
  const [cursor, setCursor] = useState('1')
  const [deleted, setDeleted] = useState(false)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const { message } = App.useApp()
  const refresh = useCallback(() => client.list(cursor, deleted).then(result => { if (!signal.aborted) setList(result) }), [client, cursor, deleted, signal])
  useEffect(() => { void refresh().catch(error => { if (!signal.aborted) setError(error.message) }) }, [refresh, signal])
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError('')
    try { await action(); client.assertCurrent(); await refresh() }
    catch (error) { if (!signal.aborted) setError(error instanceof Error ? error.message : '操作失败') }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <div className="suite-list-page">
    <div className="suite-page-heading"><div><h2>电商套图</h2><p>从真实商品图开始，逐槽位制作场景和商品展示底图。</p></div><div className="suite-actions">
      <Button onClick={() => { setCursor('1'); setDeleted(value => !value) }}>{deleted ? '返回项目' : '回收站'}</Button>
      <Button type="primary" disabled={busy} onClick={() => setCreating(true)}>新建套图项目</Button>
      <RecoveryImport actor={actor} client={client} onImported={id => navigate(`/ecommerce/${id}`)} />
    </div></div>
    <Alert type="info" showIcon message="从商品资料到完整成品版本" description="先确认槽位计划与费用，再选择结果、编辑文字和尺寸线；可进入工作站处理并显式回填。平台预检与批量导出将在后续阶段接入。" />
    {error && <Alert type="error" message={error} action={<Button onClick={() => { void run(refresh) }}>重试读取</Button>} />}
    {!list ? <Spin /> : !list.items.length ? <Empty description={deleted ? '回收站为空' : '还没有套图项目'} /> : <div className="suite-project-grid">
      {list.items.map(({ project, readySlots, enabledSlots, baseReady }) => <article className="suite-project-card" key={project.id}>
        <div><Tag>{project.config.platform === 'amazon' ? 'Amazon 美国站' : '通用模板'}</Tag><Tag>{SUITE_CATEGORY_TEMPLATES[project.config.subcategory].label}</Tag></div>
        <h3>{project.config.title}</h3><p>{readySlots}/{enabledSlots} 个启用槽位有底图</p>
        {!baseReady && <p className="suite-muted">待完成主体图上传</p>}<p className="suite-muted">更新于 {new Date(project.updatedAt).toLocaleString()}</p>
        <div className="suite-actions">{deleted ? <Button disabled={busy} onClick={() => { void run(() => client.restore(project.id)) }}>恢复项目</Button> : <>
          <Button type="primary" onClick={() => navigate(`/ecommerce/${project.id}`)}>打开项目</Button>
          <Button disabled={busy || !baseReady} onClick={() => { void run(async () => { const copy = await copySuite(client, await client.get(project.id)); message.success('配置和图片已复制，未生成或扣费'); navigate(`/ecommerce/${copy.id}`) }) }}>复制配置</Button>
          <Button danger disabled={busy} onClick={() => Modal.confirm({ title: '移入回收站？', content: '七天内可恢复；已提交原任务继续按原规则收口与结算。', okText: '移入回收站', cancelText: '取消', onOk: () => run(() => client.recycle(project.id)) })}>移入回收站</Button>
        </>}</div>
      </article>)}
    </div>}
    <div className="suite-actions">{cursor !== '1' && <Button onClick={() => setCursor(String(Number(cursor) - 1))}>上一页</Button>}{list?.nextCursor && <Button onClick={() => setCursor(list.nextCursor!)}>下一页</Button>}</div>
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
  if (!actor) return <div className="suite-list-page"><Alert type="info" showIcon message="请先登录并等待账号环境就绪" description="套图使用云端项目与平台模型，需要当前账号信息才能保存和生成。" /></div>
  if (!enabled) return <div className="suite-list-page"><Alert type="info" showIcon message="电商套图暂未开放，请稍后再试" /></div>
  return <SuiteSession key={`${actor.userId}:${actor.runtimeScope}`} actor={actor} />
}
