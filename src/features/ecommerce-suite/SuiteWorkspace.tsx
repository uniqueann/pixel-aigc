import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Modal, Select, Spin, Tabs, Tag } from 'antd'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { SuiteActor, SuiteBridge } from '@shared/ecommerce-suite'
import { suiteMainLocked } from '@shared/ecommerce-suite-annotations'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import { useStickyPreview } from '@/pages/ImageWorkstation/utils/useStickyPreview'
import type { SuiteClient } from './api'
import { listArchivedSuiteDrafts, saveSuiteBlob } from './backup'
import { copySuite } from './copy'
import { suiteFilename } from './config'
import { useSuiteWorkspace } from './useSuiteWorkspace'
import SuiteImage from './SuiteImage'
import GenerationPanel from './GenerationPanel'
import ProductFields from './ProductFields'
import VersionPanel from './VersionPanel'
import BatchPlanPanel, { type SuiteRetrySelection } from './BatchPlanPanel'
import BatchPanel from './BatchPanel'
import { backupAssetBlob, exportSuiteRecovery } from './recoveryPackage'
import { useSuiteSlotEditor, suiteDraftComposition } from './useSuiteSlotEditor'
import SuiteCanvas from './SuiteCanvas'
import LayerPanel from './LayerPanel'
import { encodeSuiteImage } from './render'
import ExportPanel from './ExportPanel'

export default function SuiteWorkspace({ id, actor, client, signal }: { id: string; actor: SuiteActor; client: SuiteClient; signal: AbortSignal }) {
  const [params, setParams] = useSearchParams()
  const requestedBatch = params.get('batch')
  const focusedBatchId = requestedBatch && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBatch) ? requestedBatch : undefined
  const workspace = useSuiteWorkspace(id, actor, client, signal, focusedBatchId)
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [productOpen, setProductOpen] = useState(false)
  const [planOpen, setPlanOpen] = useState(false)
  const [retrySelection, setRetrySelection] = useState<SuiteRetrySelection>()
  const [tab, setTab] = useState('generate')
  const [selectedLayerId, setSelectedLayerId] = useState<string>()
  const [exportSelection, setExportSelection] = useState<{ slotId?: string }>()
  const [bridgeOpen, setBridgeOpen] = useState(false)
  const [bridgeTool, setBridgeTool] = useState<SuiteBridge['tool']>('smart-edit')
  const [bridgeMode, setBridgeMode] = useState<'base' | 'composite'>('base')
  const [original, setOriginal] = useState(false)
  const [actionError, setActionError] = useState('')
  const reportError = useCallback((error: unknown) => { if (!signal.aborted) setActionError(error instanceof Error ? error.message : '操作失败') }, [signal])
  const { previewRef, footerRef, sticky } = useStickyPreview(Boolean(workspace.detail))
  const data = workspace.detail, config = workspace.editor.config
  const slotEditor = useSuiteSlotEditor(data, client, signal, workspace.offline)
  const draftStates = [...slotEditor.records.values()]
  const saveLabel = draftStates.some(record => record.error) ? '部分槽位草稿未同步，本机副本已保留'
    : draftStates.some(record => record.dirty) ? '槽位草稿待同步' : workspace.saveState
  const selectedId = workspace.editor.selectedSlotId
  const slot = config?.slots.find(slot => slot.id === selectedId) ?? config?.slots[0]
  const head = data?.project.slotHeads.find(head => head.slotId === slot?.id)
  const version = data?.versions.find(version => version.id === head?.activeVersionId)
  const layerDraft = slot ? slotEditor.records.get(slot.id) : undefined
  const draftBase = data?.versions.find(item => item.id === layerDraft?.value.baseVersionId)
  const composition = layerDraft ? suiteDraftComposition(layerDraft.value, draftBase) : version?.composition
  const staleDraft = Boolean(layerDraft && version && layerDraft.value.baseVersionId !== version.id)
  const mainLocked = Boolean(config && slot && suiteMainLocked(config, slot))
  const asset = data?.assets.find(asset => asset.assetId === (original ? config?.baseAssetId : draftBase?.assetId ?? version?.assetId))
  const active = data?.batches.some(batch => ['running', 'queued', 'blocked'].includes(batch.state)) ?? false
  const blocked = workspace.busy || workspace.offline || workspace.conflict || Boolean(workspace.pending)
  const terminalLabels = { succeeded: '已成功', failed: '已失败', expired: '已过期', cancelled: '已取消' }
  useEffect(() => {
    const requested = params.get('slot')
    if (requested && config?.slots.some(slot => slot.id === requested)) workspace.store.getState().selectSlot(requested)
  }, [config?.slots, params, workspace.store])
  const focusedBatchPresent = Boolean(focusedBatchId && data?.batches.some(batch => batch.id === focusedBatchId))
  useEffect(() => {
    if (focusedBatchId && focusedBatchPresent) document.getElementById(`batch-${focusedBatchId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusedBatchId, focusedBatchPresent])
  if (!data || !config || !slot) return <div className="suite-loading">{workspace.error ? <Alert type="error" message={workspace.error} action={<Button onClick={() => { void workspace.load().catch(reportError) }}>重试读取</Button>} /> : <div><Spin /><p role="status">正在恢复项目与原任务身份</p></div>}</div>
  const selectSlot = (slotId: string) => {
    workspace.store.getState().selectSlot(slotId)
    const next = new URLSearchParams(params); next.set('slot', slotId); setParams(next, { replace: true })
    setOriginal(false); setSelectedLayerId(undefined)
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
  const flushEditing = async () => { await workspace.flush(); await slotEditor.flushAll() }
  const saveComposition = async () => {
    await flushEditing()
    if (staleDraft) throw new Error('来源版本已改变，请先处理保留的图层草稿')
    const saved = await slotEditor.saveVersion(slot.id)
    await workspace.load()
    return saved
  }
  const prepareExport = async (slotIds: string[]) => {
    await flushEditing()
    for (const id of slotIds) {
      const current = data.project.slotHeads.find(head => head.slotId === id)?.activeVersionId
      if (current) await slotEditor.saveVersion(id)
    }
    const saved = await workspace.load()
    if (!saved) throw new Error('项目已变化，请重新读取后导出')
    return saved
  }
  const openBridge = async () => {
    const saved = await saveComposition()
    const current = await client.get(id)
    const head = current.project.slotHeads.find(item => item.slotId === slot.id)!
    let compositeAssetId: string | undefined
    if (bridgeMode === 'composite') {
      const source = current.assets.find(item => item.assetId === saved.assetId)!
      const blob = await encodeSuiteImage(await backupAssetBlob(actor, source, signal), saved.composition, 'png', mainLocked ? '#ffffff' : undefined)
      compositeAssetId = (await client.upload(id, crypto.randomUUID(), blob, '已确认烘焙图层的工作站输入')).assetId
    }
    const bridge = await client.createBridge(id, { slotId: slot.id, sourceVersionId: saved.id, expectedHeadRevision: head.headRevision,
      tool: bridgeTool, inputMode: bridgeMode, ...(compositeAssetId ? { compositeAssetId } : {}) })
    client.assertCurrent(); navigate(`/image-workstation/${bridge.tool}?bridgeId=${bridge.id}`)
  }
  return <div className="suite-workspace">
    <div className="suite-page-heading"><div><Button type="text" onClick={() => { void workspace.run(async () => { await flushEditing(); navigate('/ecommerce') }).catch(reportError) }}>‹ 返回项目</Button>
      <h2>{config.title}</h2><p>{config.platform === 'amazon' ? 'Amazon 美国站' : '通用模板'} · {saveLabel}</p></div>
      <div className="suite-actions"><Button type="primary" disabled={blocked || active} onClick={() => { setRetrySelection(undefined); setPlanOpen(true) }}>整套计划／风格重生成</Button><Button onClick={() => setProductOpen(true)}>商品资料</Button><Button disabled={workspace.busy} onClick={() => { void workspace.run(async () => { await flushEditing(); return workspace.completeBackup() }).then(() => message.success('历史版本与图片已完整备份到当前账号环境')).catch(reportError) }}>更新完整本地备份</Button>
        <Button disabled={workspace.busy || workspace.offline} onClick={() => { void workspace.run(async () => { await flushEditing(); const zip = await exportSuiteRecovery(client, id, actor, signal); downloadBlob(zip, `${suiteFilename(config.title, '恢复包', 1, { width: 1, height: 1 }, 'image/png').replace(/\.png$/, '')}.zip`) }).catch(reportError) }}>下载含图片恢复包</Button></div>
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
          <Button size="small" onClick={() => setOriginal(value => !value)}>{original ? '查看当前成品' : '对照商品原图'}</Button>
          <Button size="small" disabled={!version || original || blocked} onClick={() => setExportSelection({ slotId: slot.id })}>下载当前成品</Button>
          <Button size="small" disabled={!version || blocked} onClick={() => setBridgeOpen(true)}>工作站编辑</Button>
        </div></div>
        <div className="suite-stage">{asset && composition && !original ? <SuiteCanvas asset={asset} composition={composition} client={client} signal={signal}
          selectedId={selectedLayerId} onSelect={setSelectedLayerId} background={mainLocked ? '#ffffff' : 'transparent'} editable={tab === 'layers' && !workspace.busy && !mainLocked && !staleDraft}
          onChange={layers => slotEditor.edit(slot.id, { layers })} /> : <SuiteImage asset={asset} client={client} offline={workspace.offline} alt={original ? '商品原图' : `${slot.name}当前版本`} />}</div>
        <div className="suite-slot-strip" aria-label="套图槽位">{config.slots.map(item => {
          const slotHead = data.project.slotHeads.find(head => head.slotId === item.id)
          const current = data.versions.find(version => version.id === slotHead?.activeVersionId)
          const thumbnail = data.assets.find(asset => asset.assetId === current?.assetId)
          const operation = data.operations.filter(operation => operation.slotId === item.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
          const state = !item.enabled ? '已跳过' : current ? '已有底图' : operation?.phase === 'stopped' ? '本次已停止' : operation?.phase === 'blocked' ? '待重新确认' : operation && !operation.terminalState ? '处理中' : operation?.appliedVersionIds.length ? '待选用' : operation?.terminalState ? '未完成' : '待处理'
          return <button type="button" key={item.id} aria-pressed={item.id === slot.id} aria-label={`${item.name}，${state}`} onClick={() => selectSlot(item.id)}>
            <span className="suite-thumbnail">{thumbnail ? <SuiteImage asset={thumbnail} client={client} offline={workspace.offline} alt={item.name} /> : <span>{item.order + 1}</span>}</span><strong>{item.name}</strong><small>{state}</small>
          </button>
        })}</div>
        <p className="suite-muted">{workspace.backupState}。单图与成品包共用固定字体和完整图层，导出前检查实际文件。</p>
      </div>
      <section className="suite-settings">
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'generate', label: '重生成', children: <GenerationPanel key={slot.id} project={data.project} slot={slot} draft={layerDraft}
            client={client} blocked={blocked || active} flush={flushEditing} onSubmit={quote => workspace.run(() => workspace.submit(quote)).then(() => undefined)} onEdit={patch => slotEditor.edit(slot.id, patch)} flushDraft={() => slotEditor.flushSlot(slot.id)} onError={reportError} /> },
          { key: 'layers', label: '文字与标注', children: <LayerPanel draft={layerDraft?.value} composition={composition} config={config} selectedId={selectedLayerId}
            locked={mainLocked} disabled={workspace.busy} error={layerDraft?.error} stale={staleDraft} onSelect={setSelectedLayerId} onEdit={patch => slotEditor.edit(slot.id, patch)}
            onSave={() => { void workspace.run(saveComposition).catch(reportError) }} onReset={() => { if (version) void workspace.run(() => slotEditor.reset(slot.id, version)).catch(reportError) }}
            onReadCloud={() => { void workspace.run(() => slotEditor.readCloud(slot.id)).catch(reportError) }}
            onDownloadArchives={() => { void workspace.run(async () => { const saved = await listArchivedSuiteDrafts(actor,id,slot.id); client.assertCurrent(); downloadBlob(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}),'套图归档草稿.json') }).catch(reportError) }} /> },
          { key: 'versions', label: '版本', children: <VersionPanel key={slot.id} client={client} project={data.project} slotId={slot.id} versions={data.versions} disabled={blocked}
            onError={reportError} onSelect={async selected => { await workspace.run(async () => { await flushEditing();
              await client.select(id, slot.id, selected.id, data.project.slotHeads.find(head => head.slotId === slot.id)!.headRevision); await slotEditor.reset(slot.id, selected); await workspace.load() }) }} /> },
        ]} />
        <div className="suite-upload-controls"><strong>{slot.kind === 'size' ? '已标注尺寸成品（选填；无图时在原图添加尺寸线）' : slot.kind === 'detail' ? '真实细节照片' : '场景参考图（选填）'}</strong>
          <label className="suite-file-button">上传{slot.kind === 'detail' ? '细节照片' : '参考图'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked || active || slot.kind === 'main'} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void workspace.run(() => upload(file, false)).catch(reportError) }} /></label>
          {slot.referenceAssetIds.length > 0 && <><Tag>已保存 {slot.referenceAssetIds.length} 张</Tag><Button size="small" disabled={blocked || active} onClick={() => workspace.edit({ ...config, slots: config.slots.map(item => item.id === slot.id ? { ...item, referenceAssetIds: [] } : item) })}>移除引用</Button></>}
        </div>
        <Button block disabled={workspace.busy || workspace.offline} onClick={() => { void workspace.run(workspace.settleOriginals).catch(reportError) }}>读取原任务并恢复已生成结果</Button>
        {data.operations.filter(operation => operation.slotId === slot.id).map(operation => {
          const task = data.tasks.find(task => task.sourceId === operation.task?.sourceId)
          const billing = operation.mode === 'reuse' ? '原图复用，无生成费用' : !task ? operation.task ? '原任务账本暂不可查，费用未知' : '尚未派发，无预扣'
            : task.billingState === 'reserved' ? `预扣 ${task.creditsReserved} 积分，等待结算` : task.creditsCharged === null ? '结算状态待确认'
              : `已扣 ${task.creditsCharged} 积分${task.creditsReturned ? `，退回 ${task.creditsReturned} 积分` : ''}`
          return <div className="suite-task-line" key={operation.id}><strong>{task ? `${task.completedCount}/${task.requestedCount} 张候选成功` : operation.mode === 'reuse' ? '原图复用' : operation.phase === 'stopped' ? '本次已停止' : operation.phase === 'blocked' ? '等待重新确认' : operation.terminalState ? terminalLabels[operation.terminalState] : operation.task ? '正在读取原任务' : '等待服务端派发'}</strong><span>{billing}</span>
            <small>原请求 {operation.requestId}</small>{task?.errorCode && <span>{task.errorCode}；可在收口后手动确认新尝试</span>}
            {operation.appliedVersionIds.some(id => id !== head?.activeVersionId) && <Button size="small" onClick={() => setTab('versions')}>查看候选版本</Button>}
          </div>
        })}
      </section>
    </div>
    <div ref={footerRef} className="suite-footer"><span>{data.project.slotHeads.filter(head => head.activeVersionId && config.slots.some(slot => slot.id === head.slotId && slot.enabled)).length} / {config.slots.filter(slot => slot.enabled).length} 个启用槽位有底图</span>
      <span>{active ? '服务端批次处理中，可查看已有成品' : '槽位独立版本 · 失败仅手动重试'}</span><Button disabled={workspace.busy || workspace.conflict} onClick={() => { void workspace.run(flushEditing).catch(reportError) }}>立即保存草稿</Button>
      <Button type="primary" disabled={blocked} onClick={() => setExportSelection({})}>平台预检／批量导出</Button></div>
    {exportSelection && <ExportPanel actor={actor} data={data} client={client} signal={signal} initialSlotId={exportSelection.slotId}
      liveKey={JSON.stringify([config, data.project.slotHeads, [...slotEditor.records].map(([id, record]) => [id, record.value])])}
      prepare={prepareExport} onClose={() => setExportSelection(undefined)} />}
    <BatchPanel data={data} disabled={blocked} focusedBatchId={focusedBatchId} onStop={batchId => { void workspace.run(async () => { await client.stop(id, batchId); await workspace.load() }).catch(reportError) }}
      onRetry={selection => { setRetrySelection(selection); setPlanOpen(true) }} />
    {planOpen && <BatchPlanPanel data={data} client={client} retry={retrySelection} blocked={blocked} flush={flushEditing}
      onSubmit={quote => workspace.run(() => workspace.submit(quote)).then(() => undefined)} onClose={() => setPlanOpen(false)} onError={reportError} />}
    <Modal title="进入图片工作站" open={bridgeOpen} onCancel={() => setBridgeOpen(false)}
      footer={<Button type="primary" disabled={blocked || !version} loading={workspace.busy} onClick={() => { void workspace.run(openBridge).catch(reportError) }}>保存当前版本并进入</Button>}>
      <div className="suite-product-fields"><label>编辑工具<Select value={bridgeTool} onChange={setBridgeTool} options={[{ value: 'repaint', label: '重绘' }, { value: 'smart-edit', label: '智能编辑' }, { value: 'retouch', label: '精修' }, { value: 'relight', label: '重新打光' }]} /></label>
      <label>输入内容<Select value={bridgeMode} onChange={setBridgeMode} options={[{ value: 'base', label: '无叠加图层的底图（推荐）' }, { value: 'composite', label: '包含文字与标注的合成图' }]} /></label></div>
      <p>{bridgeMode === 'base' ? '独立图层留在套图，回填后可继续编辑。' : '文字和标注将烘焙进输入图片，回填不会重复叠加原图层。'}</p>
      <p>原工具按原规则确认并收费，回填不再次收费。会话保留七天；结果先保存候选，手动设为当前。尺寸变化后请重新核对图层位置。</p>
    </Modal>
    <Modal title="商品资料与确认事实" open={productOpen} onCancel={() => setProductOpen(false)} width={740} footer={<Button type="primary" loading={workspace.busy} onClick={() => { void workspace.run(async () => { await workspace.flush(); setProductOpen(false) }).catch(reportError) }}>保存资料</Button>}>
      <ProductFields value={config} onChange={workspace.edit} disabled={workspace.busy} />
      <label className="suite-file-button">{data.assets.some(asset => asset.assetId === config.baseAssetId) ? '更换商品主体图' : '完成商品主体图上传'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked || active} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void workspace.run(() => upload(file, true)).catch(reportError) }} /></label>
    </Modal>
  </div>
}
