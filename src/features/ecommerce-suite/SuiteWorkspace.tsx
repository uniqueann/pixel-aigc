import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Modal, Spin, Tabs, Tag } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { SuiteActor } from '@shared/ecommerce-suite'
import { fetchOwnedObject } from '@/services/api/objects'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import { useStickyPreview } from '@/pages/ImageWorkstation/utils/useStickyPreview'
import type { SuiteClient } from './api'
import { readSuiteBlob, saveSuiteBlob } from './backup'
import { copySuite } from './copy'
import { suiteFilename } from './config'
import { useSuiteWorkspace } from './useSuiteWorkspace'
import SuiteImage from './SuiteImage'
import GenerationPanel from './GenerationPanel'
import ProductFields from './ProductFields'
import VersionPanel from './VersionPanel'
import { exportSuiteRecovery } from './recoveryPackage'

export default function SuiteWorkspace({ id, actor, client, signal }: { id: string; actor: SuiteActor; client: SuiteClient; signal: AbortSignal }) {
  const workspace = useSuiteWorkspace(id, actor, client, signal)
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [productOpen, setProductOpen] = useState(false)
  const [tab, setTab] = useState('generate')
  const [original, setOriginal] = useState(false)
  const [actionError, setActionError] = useState('')
  const reportError = useCallback((error: unknown) => { if (!signal.aborted) setActionError(error instanceof Error ? error.message : '操作失败') }, [signal])
  const { previewRef, footerRef, sticky } = useStickyPreview(Boolean(workspace.detail))
  const data = workspace.detail, config = workspace.editor.config
  const selectedId = workspace.editor.selectedSlotId
  const slot = config?.slots.find(slot => slot.id === selectedId) ?? config?.slots[0]
  const head = data?.project.slotHeads.find(head => head.slotId === slot?.id)
  const version = data?.versions.find(version => version.id === head?.activeVersionId)
  const asset = data?.assets.find(asset => asset.assetId === (original ? config?.baseAssetId : version?.assetId))
  const active = data?.batches.some(batch => ['running', 'queued', 'blocked'].includes(batch.state)) ?? false
  const blocked = workspace.busy || workspace.offline || workspace.conflict || Boolean(workspace.pending)
  const terminalLabels = { succeeded: '已成功', failed: '已失败', expired: '已过期', cancelled: '已取消' }
  useEffect(() => {
    const requested = params.get('slot')
    if (requested && config?.slots.some(slot => slot.id === requested)) workspace.store.getState().selectSlot(requested)
  }, [config?.slots, params, workspace.store])
  if (!data || !config || !slot) return <div className="suite-loading">{workspace.error ? <Alert type="error" message={workspace.error} action={<Button onClick={() => { void workspace.load().catch(reportError) }}>重试读取</Button>} /> : <div><Spin /><p role="status">正在恢复项目与原任务身份</p></div>}</div>
  const selectSlot = (slotId: string) => {
    workspace.store.getState().selectSlot(slotId)
    const next = new URLSearchParams(params); next.set('slot', slotId); setParams(next, { replace: true })
    setOriginal(false)
  }
  const upload = async (blob: Blob, base: boolean) => {
    await workspace.flush()
    const id = base && !data.assets.some(asset => asset.assetId === config.baseAssetId) ? config.baseAssetId : crypto.randomUUID()
    const uploaded = await client.upload(data.project.id, id, blob, base ? '商品主体图' : '槽位参考图')
    await saveSuiteBlob(actor, data.project.id, uploaded.assetId, blob).catch(() => undefined)
    const current = workspace.store.getState().config!
    workspace.edit(base ? { ...current, baseAssetId: uploaded.assetId } : { ...current, slots: current.slots.map(item => item.id === slot.id ? { ...item, referenceAssetIds: [uploaded.assetId] } : item) })
    await workspace.flush(); await workspace.load()
  }
  const download = async () => {
    await workspace.flush()
    if (!asset || !version || original) throw new Error('请选择一个已保存的当前版本')
    const frozen = { asset, version, title: config.title, slotName: slot.name }
    const blob = await readSuiteBlob(actor, id, frozen.asset.assetId) ?? await fetchOwnedObject(frozen.asset.objectKey, undefined, signal)
    client.assertCurrent()
    downloadBlob(blob, suiteFilename(frozen.title, frozen.slotName, frozen.version.versionNumber, frozen.asset.size, frozen.asset.mimeType))
  }
  return <div className="suite-workspace">
    <div className="suite-page-heading"><div><Button type="text" onClick={() => { void workspace.run(async () => { await workspace.flush(); navigate('/ecommerce') }).catch(reportError) }}>‹ 返回项目</Button>
      <h2>{config.title}</h2><p>{config.platform === 'amazon' ? 'Amazon 美国站' : '通用模板'} · {workspace.saveState}</p></div>
      <div className="suite-actions"><Button onClick={() => setProductOpen(true)}>商品资料</Button><Button disabled={workspace.busy} onClick={() => { void workspace.run(() => workspace.completeBackup()).then(() => message.success('历史版本与图片已完整备份到当前账号环境')).catch(reportError) }}>更新完整本地备份</Button>
        <Button disabled={workspace.busy || workspace.offline} onClick={() => { void workspace.run(async () => { await workspace.flush(); const zip = await exportSuiteRecovery(client, id, actor, signal); downloadBlob(zip, `${suiteFilename(config.title, '恢复包', 1, { width: 1, height: 1 }, 'image/png').replace(/\.png$/, '')}.zip`) }).catch(reportError) }}>下载含图片恢复包</Button></div>
    </div>
    {(workspace.error || actionError) && <Alert showIcon type="warning" message={actionError || workspace.error} />}
    {workspace.offline && <Alert type="warning" showIcon message="正在使用本地备份，可继续编辑；联网并保存成功后才能生成。" action={<Button onClick={() => { void workspace.run(workspace.reloadCloud).catch(reportError) }}>重新连接云端</Button>} />}
    {workspace.conflict && <Alert type="warning" showIcon message="云端配置已更新，本机副本已保留。" action={<div className="suite-actions">
      <Button onClick={() => { void workspace.run(workspace.reloadCloud).catch(reportError) }}>读取云端</Button>
      <Button onClick={() => { void workspace.run(async () => { const copy = await copySuite(client, data, config); navigate(`/ecommerce/${copy.id}`) }).catch(reportError) }}>另存为新项目</Button>
    </div>} />}
    {workspace.pending && <Alert type="warning" showIcon message="提交结果待确认，保留原编号，不重复生成。" description={`原请求：${workspace.pending.requestId}`} action={<Button loading={workspace.busy} onClick={() => { void workspace.run(workspace.recoverPending).catch(reportError) }}>查询原批次</Button>} />}
    <div className="suite-body">
      <div ref={previewRef} className={`suite-preview${sticky ? ' suite-preview-sticky' : ''}`}>
        <div className="suite-preview-heading"><strong>{slot.name}</strong><div className="suite-actions">
          <Button size="small" onClick={() => setOriginal(value => !value)}>{original ? '查看当前底图' : '对照商品原图'}</Button>
          <Button size="small" disabled={!version || original || workspace.busy} onClick={() => { void workspace.run(download).catch(reportError) }}>下载当前底图</Button>
        </div></div>
        <div className="suite-stage"><SuiteImage asset={asset} client={client} offline={workspace.offline} alt={original ? '商品原图' : `${slot.name}当前版本`} /></div>
        <div className="suite-slot-strip" aria-label="套图槽位">{config.slots.map(item => {
          const slotHead = data.project.slotHeads.find(head => head.slotId === item.id)
          const current = data.versions.find(version => version.id === slotHead?.activeVersionId)
          const thumbnail = data.assets.find(asset => asset.assetId === current?.assetId)
          const operation = [...data.operations].reverse().find(operation => operation.slotId === item.id)
          const state = !item.enabled ? '已跳过' : current ? '已有底图' : operation && !operation.terminalState ? '处理中' : operation?.appliedVersionIds.length ? '待选用' : operation?.terminalState ? '未完成' : '待处理'
          return <button type="button" key={item.id} aria-pressed={item.id === slot.id} aria-label={`${item.name}，${state}`} onClick={() => selectSlot(item.id)}>
            <span className="suite-thumbnail">{thumbnail ? <SuiteImage asset={thumbnail} client={client} offline={workspace.offline} alt={item.name} /> : <span>{item.order + 1}</span>}</span><strong>{item.name}</strong><small>{state}</small>
          </button>
        })}</div>
        <p className="suite-muted">{workspace.backupState}。当前下载为已保存底图，平台预检与文字合成将在后续阶段接入。</p>
      </div>
      <section className="suite-settings">
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'generate', label: '重生成', children: <GenerationPanel key={slot.id} project={data.project} slot={slot} draft={data.drafts.find(draft => draft.slotId === slot.id)}
            client={client} blocked={blocked || active} flush={workspace.flush} onSubmit={quote => workspace.run(() => workspace.submit(quote)).then(() => undefined)} onSaved={workspace.load} onError={reportError} /> },
          { key: 'layers', label: '文字与标注', children: <Alert type="info" message="文字和尺寸图层在第四阶段接入" description="商品规格可先在商品资料中填写、确认并保存；当前底图版本会保留对应的确认事实快照。" /> },
          { key: 'versions', label: '版本', children: <VersionPanel key={slot.id} client={client} project={data.project} slotId={slot.id} versions={data.versions} disabled={blocked}
            onError={reportError} onSelect={async selected => { await workspace.run(async () => { await workspace.flush();
              await client.select(id, slot.id, selected.id, data.project.slotHeads.find(head => head.slotId === slot.id)!.headRevision); await workspace.load() }) }} /> },
        ]} />
        <div className="suite-upload-controls"><strong>{slot.kind === 'detail' ? '真实细节照片' : '场景参考图（选填）'}</strong>
          <label className="suite-file-button">上传{slot.kind === 'detail' ? '细节照片' : '参考图'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked || active || ['main', 'size'].includes(slot.kind)} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void workspace.run(() => upload(file, false)).catch(reportError) }} /></label>
          {slot.referenceAssetIds.length > 0 && <><Tag>已保存 {slot.referenceAssetIds.length} 张</Tag><Button size="small" disabled={blocked || active} onClick={() => workspace.edit({ ...config, slots: config.slots.map(item => item.id === slot.id ? { ...item, referenceAssetIds: [] } : item) })}>移除引用</Button></>}
        </div>
        <Button block disabled={workspace.busy || workspace.offline} onClick={() => { void workspace.run(workspace.settleOriginals).catch(reportError) }}>读取原任务并恢复已生成结果</Button>
        {data.operations.filter(operation => operation.slotId === slot.id).map(operation => {
          const task = data.tasks.find(task => task.sourceId === operation.task?.sourceId)
          const billing = operation.mode === 'reuse' ? '原图复用，无生成费用' : !task ? '原任务账本暂不可查，费用未知'
            : task.billingState === 'reserved' ? `预扣 ${task.creditsReserved} 积分，等待结算` : task.creditsCharged === null ? '结算状态待确认'
              : `已扣 ${task.creditsCharged} 积分${task.creditsReturned ? `，退回 ${task.creditsReturned} 积分` : ''}`
          return <div className="suite-task-line" key={operation.id}><strong>{task ? `${task.completedCount}/${task.requestedCount} 张候选成功` : operation.mode === 'reuse' ? '原图复用' : operation.terminalState ? terminalLabels[operation.terminalState] : '正在确认原任务'}</strong><span>{billing}</span>
            <small>原请求 {operation.requestId}</small>{task?.errorCode && <span>{task.errorCode}；可在收口后手动确认新尝试</span>}
            {operation.appliedVersionIds.some(id => id !== head?.activeVersionId) && <Button size="small" onClick={() => setTab('versions')}>查看候选版本</Button>}
          </div>
        })}
      </section>
    </div>
    <div ref={footerRef} className="suite-footer"><span>{data.project.slotHeads.filter(head => head.activeVersionId && config.slots.some(slot => slot.id === head.slotId && slot.enabled)).length} / {config.slots.filter(slot => slot.enabled).length} 个启用槽位有底图</span>
      <span>{active ? '原任务处理中，可查看已有成品' : '单槽位处理 · 失败仅手动重试'}</span><Button disabled={workspace.busy || workspace.conflict} onClick={() => { void workspace.run(workspace.flush).catch(reportError) }}>立即保存资料</Button></div>
    <Modal title="商品资料与确认事实" open={productOpen} onCancel={() => setProductOpen(false)} width={740} footer={<Button type="primary" loading={workspace.busy} onClick={() => { void workspace.run(async () => { await workspace.flush(); setProductOpen(false) }).catch(reportError) }}>保存资料</Button>}>
      <ProductFields value={config} onChange={workspace.edit} disabled={workspace.busy} />
      <label className="suite-file-button">{data.assets.some(asset => asset.assetId === config.baseAssetId) ? '更换商品主体图' : '完成商品主体图上传'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked || active} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void workspace.run(() => upload(file, true)).catch(reportError) }} /></label>
    </Modal>
  </div>
}
