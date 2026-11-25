import { useCallback, useEffect, useState } from 'react'
import { Alert, App, Button, Dropdown, Modal, Select, Spin, Tabs, Tag } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { SuiteActor, SuiteBridge } from '@shared/ecommerce-suite'
import { suiteMainLocked } from '@shared/ecommerce-suite-annotations'
import { downloadBlob } from '@/pages/Toolbox/shared/zip'
import { useStickyPreview } from '@/pages/ImageWorkstation/utils/useStickyPreview'
import type { SuiteClient } from './api'
import { listArchivedSuiteDrafts, saveSuiteBlob } from './backup'
import { copySuite } from './copy'
import { suiteFilename } from './config'
import { formatSuiteError, suitePlatformLabel, suiteSlotLabel, suiteWorkstationToolLabel } from './i18n'
import { useSuiteWorkspace } from './useSuiteWorkspace'
import SuiteImage from './SuiteImage'
import GenerationPanel from './GenerationPanel'
import ProductFields from './ProductFields'
import VersionPanel from './VersionPanel'
import BatchPlanPanel, { type SuiteRetrySelection } from './BatchPlanPanel'
import BatchPanel from './BatchPanel'
import { backupAssetBlob, exportSuiteRecovery } from './recoveryPackage'
import { useSuiteSlotEditor, suiteDraftComposition } from './useSuiteSlotEditor'
import { uploadSuiteAsset } from './uploadAsset'
import SuiteCanvas from './SuiteCanvas'
import LayerPanel from './LayerPanel'
import { encodeSuiteImage } from './render'
import ExportPanel from './ExportPanel'

export default function SuiteWorkspace({ id, actor, client, signal }: { id: string; actor: SuiteActor; client: SuiteClient; signal: AbortSignal }) {
  const { t } = useTranslation(['ecommerce', 'common'])
  const [params, setParams] = useSearchParams()
  const requestedBatch = params.get('batch')
  const focusedBatchId = requestedBatch && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedBatch) ? requestedBatch : undefined
  const workspace = useSuiteWorkspace(id, actor, client, signal, focusedBatchId)
  const { message, modal } = App.useApp()
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
  const reportError = useCallback((error: unknown) => { if (!signal.aborted) setActionError(formatSuiteError(error, 'ecommerce:errors.actionFailed')) }, [signal])
  const { previewRef, footerRef, sticky } = useStickyPreview(Boolean(workspace.detail))
  const data = workspace.detail, config = workspace.editor.config
  const slotEditor = useSuiteSlotEditor(data, client, signal, workspace.offline)
  const draftStates = [...slotEditor.records.values()]
  const saveLabel = draftStates.some(record => record.error) ? t('ecommerce:workspace.saveStates.slotDraftsError')
    : draftStates.some(record => record.dirty) ? t('ecommerce:workspace.saveStates.slotDraftsDirty') : workspace.saveState
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
  useEffect(() => {
    const requested = params.get('slot')
    if (requested && config?.slots.some(slot => slot.id === requested)) workspace.store.getState().selectSlot(requested)
  }, [config?.slots, params, workspace.store])
  const focusedBatchPresent = Boolean(focusedBatchId && data?.batches.some(batch => batch.id === focusedBatchId))
  useEffect(() => {
    if (focusedBatchId && focusedBatchPresent) document.getElementById(`batch-${focusedBatchId}`)?.scrollIntoView({ block: 'nearest' })
  }, [focusedBatchId, focusedBatchPresent])
  if (!data || !config || !slot) return <div className="suite-loading">{workspace.error ? <Alert type="error" message={workspace.error} action={<Button onClick={() => { void workspace.load().catch(reportError) }}>{t('common:actions.retryLoad')}</Button>} /> : <div><Spin /><p role="status">{t('ecommerce:workspace.loadingStatus')}</p></div>}</div>
  const slotDisplayName = suiteSlotLabel(slot)
  const selectSlot = (slotId: string) => {
    workspace.store.getState().selectSlot(slotId)
    const next = new URLSearchParams(params); next.set('slot', slotId); setParams(next, { replace: true })
    setOriginal(false); setSelectedLayerId(undefined)
  }
  const upload = async (blob: Blob, base: boolean) => {
    await workspace.flush()
    const reserved = base && !data.assets.some(asset => asset.assetId === config.baseAssetId)
    const uploaded = await uploadSuiteAsset(client, data.project.id, reserved ? config.baseAssetId : crypto.randomUUID(),
      blob, base ? t('ecommerce:upload.baseAssetName') : t('ecommerce:upload.referenceAssetName'), reserved)
    await saveSuiteBlob(actor, data.project.id, uploaded.assetId, blob).catch(() => undefined)
    const current = workspace.store.getState().config!
    workspace.edit(base ? { ...current, baseAssetId: uploaded.assetId } : { ...current, slots: current.slots.map(item => item.id === slot.id ? { ...item, referenceAssetIds: [uploaded.assetId] } : item) })
    await workspace.flush(); await workspace.load()
  }
  const flushEditing = async () => { await workspace.flush(); await slotEditor.flushAll() }
  const saveComposition = async () => {
    await flushEditing()
    if (staleDraft) throw new Error(t('ecommerce:workspace.errors.staleDraftConflict'))
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
    if (!saved) throw new Error(t('ecommerce:workspace.errors.projectChangedBeforeExport'))
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
      compositeAssetId = (await client.upload(id, crypto.randomUUID(), blob, t('ecommerce:bridge.compositeAssetName'))).assetId
    }
    const bridge = await client.createBridge(id, { slotId: slot.id, sourceVersionId: saved.id, expectedHeadRevision: head.headRevision,
      tool: bridgeTool, inputMode: bridgeMode, ...(compositeAssetId ? { compositeAssetId } : {}) })
    client.assertCurrent(); navigate(`/image-workstation/${bridge.tool}?bridgeId=${bridge.id}`)
  }
  const backupMenuItems = [
      { key: 'backup', label: t('ecommerce:workspace.backupMenu.updateLocal'), onClick: () => { void workspace.run(async () => { await flushEditing(); return workspace.completeBackup() }).then(() => message.success(t('ecommerce:workspace.backupMenu.backupSuccess'))).catch(reportError) } },
      { key: 'export', label: t('ecommerce:workspace.backupMenu.exportRecovery'), onClick: () => { void workspace.run(async () => { await flushEditing(); const zip = await exportSuiteRecovery(client, id, actor, signal); downloadBlob(zip, `${suiteFilename(config.title, t('ecommerce:backup.recoveryFilenameSuffix'), 1, { width: 1, height: 1 }, 'image/png').replace(/\.png$/, '')}.zip`) }).catch(reportError) } },
    ]
    return <div className="suite-workspace">
      <div className="suite-page-heading">
        <div className="suite-heading-left">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            className="suite-back-btn"
            title={t('ecommerce:list.backToList')}
            aria-label={t('ecommerce:list.backToList')}
            onClick={() => { void workspace.run(async () => { await flushEditing(); navigate('/ecommerce') }).catch(reportError) }}
          >
            {t('ecommerce:workspace.backShort')}
          </Button>
          <span className="suite-heading-divider" aria-hidden="true" />
          <h2 className="suite-project-title" title={config.title}>{config.title}</h2>
          <Tag className="suite-platform-tag">{suitePlatformLabel(config.platform)}</Tag>
          <span className="suite-heading-status" title={saveLabel}>{saveLabel}</span>
        </div>
        <div className="suite-actions"><Button type="primary" disabled={blocked || active} onClick={() => { setRetrySelection(undefined); setPlanOpen(true) }}>{t('ecommerce:workspace.batchGenerateButton')}</Button><Button onClick={() => setProductOpen(true)}>{t('ecommerce:workspace.productFieldsButton')}</Button>
          <Dropdown menu={{ items: backupMenuItems }} disabled={workspace.busy}>
            <Button>{t('ecommerce:workspace.backupButton')}</Button>
          </Dropdown>
        </div>
      </div>
      {(workspace.error || actionError) && <Alert showIcon type="warning" message={actionError || workspace.error} />}
      {workspace.offline && <Alert type="warning" showIcon message={t('ecommerce:workspace.offlineBanner')} action={<Button onClick={() => { void workspace.run(workspace.reloadCloud).catch(reportError) }}>{t('ecommerce:workspace.reconnectButton')}</Button>} />}
      {workspace.conflict && <Alert type="warning" showIcon message={t('ecommerce:workspace.conflictBanner')} action={<div className="suite-actions">
        <Button onClick={() => { void workspace.run(() => workspace.reloadCloud(true)).catch(reportError) }}>{t('ecommerce:workspace.loadCloudButton')}</Button>
        <Button onClick={() => { void workspace.run(async () => { const copy = await copySuite(client, data, config); navigate(`/ecommerce/${copy.id}`) }).catch(reportError) }}>{t('ecommerce:workspace.saveAsNewProjectButton')}</Button>
      </div>} />}
      {workspace.pending && <Alert type="warning" showIcon message={t('ecommerce:workspace.pendingBanner')} description={t('ecommerce:workspace.pendingRequestDesc', { requestId: workspace.pending.requestId })} action={<div className="suite-actions">
        <Button loading={workspace.busy} onClick={() => { void workspace.run(workspace.recoverPending).catch(reportError) }}>{t('ecommerce:workspace.queryOriginalBatch')}</Button>
        <Button danger disabled={workspace.busy} onClick={() => modal.confirm({
          title: t('ecommerce:workspace.abandonConfirmTitle'),
          content: t('ecommerce:workspace.abandonConfirmContent'),
          okText: t('ecommerce:workspace.abandonConfirmOk'), okButtonProps: { danger: true }, cancelText: t('ecommerce:workspace.abandonConfirmCancel'),
          onOk: () => workspace.run(workspace.abandonPending).then(result => {
            if (result === 'abandoned') message.warning(t('ecommerce:workspace.abandonedWarning'))
            else if (result === 'recovered') message.success(t('ecommerce:workspace.recoveredSuccess'))
          }).catch(reportError),
        })}>{t('ecommerce:workspace.abandonPendingButton')}</Button>
      </div>} />}
      <div className="suite-body">
        <div ref={previewRef} className={`suite-preview${sticky ? ' suite-preview-sticky' : ''}`}>
          <div className="suite-preview-heading"><strong>{slotDisplayName}</strong><div className="suite-actions">
            <Button size="small" onClick={() => setOriginal(value => !value)}>{original ? t('ecommerce:workspace.viewCurrentVersion') : t('ecommerce:workspace.compareOriginal')}</Button>
            <Button size="small" disabled={!version || blocked} onClick={() => setBridgeOpen(true)}>{t('ecommerce:workspace.workstationRetouch')}</Button>
          </div></div>
          <div className="suite-stage">{asset && composition && !original ? <SuiteCanvas asset={asset} composition={composition} client={client} signal={signal}
            selectedId={selectedLayerId} onSelect={setSelectedLayerId} background={mainLocked ? '#ffffff' : 'transparent'} editable={tab === 'layers' && !workspace.busy && !mainLocked && !staleDraft}
            onChange={layers => slotEditor.edit(slot.id, { layers })} /> : <SuiteImage asset={asset} client={client} offline={workspace.offline} alt={original ? t('ecommerce:workspace.originalImageAlt') : t('ecommerce:workspace.currentVersionAlt', { name: slotDisplayName })} />}</div>
          <div className="suite-slot-strip" aria-label={t('ecommerce:workspace.slotStripAria')}>{config.slots.map(item => {
            const slotHead = data.project.slotHeads.find(head => head.slotId === item.id)
            const current = data.versions.find(version => version.id === slotHead?.activeVersionId)
            const thumbnail = data.assets.find(asset => asset.assetId === current?.assetId)
            const operation = data.operations.filter(operation => operation.slotId === item.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
            const isDone = Boolean(current)
            const isRunning = Boolean(operation && !operation.terminalState)
            const isFailed = Boolean(operation?.terminalState && !current)
            const dotColor = isDone ? '#21cfa0' : isRunning ? '#eab308' : isFailed ? '#ef4444' : '#cbd5e1'
            const state = !item.enabled ? t('ecommerce:workspace.slotStates.skipped')
              : current ? t('ecommerce:workspace.slotStates.generated')
                : operation?.phase === 'stopped' ? t('ecommerce:workspace.slotStates.stopped')
                  : operation?.phase === 'blocked' ? t('ecommerce:workspace.slotStates.blocked')
                    : isRunning ? t('ecommerce:workspace.slotStates.running')
                      : operation?.appliedVersionIds.length ? t('ecommerce:workspace.slotStates.newVersion')
                        : isFailed ? t('ecommerce:workspace.slotStates.failed')
                          : t('ecommerce:workspace.slotStates.notGenerated')
            const itemName = suiteSlotLabel(item)
            return <button type="button" key={item.id} aria-pressed={item.id === slot.id} aria-label={t('ecommerce:workspace.slotButtonAria', { name: itemName, state })} onClick={() => selectSlot(item.id)}>
              <span className="suite-thumbnail" style={{ position: 'relative' }}>
                <span style={{ position: 'absolute', top: 5, right: 5, width: 8, height: 8, borderRadius: '50%', background: dotColor, zIndex: 2 }} />
                {thumbnail ? <SuiteImage asset={thumbnail} client={client} offline={workspace.offline} variant="thumbnail" alt={itemName} /> : <span>{item.order + 1}</span>}
              </span><strong>{itemName}</strong><small>{state}</small>
            </button>
          })}</div>
        <p className="suite-muted">{t('ecommerce:workspace.backupFootnote', { status: workspace.backupState })}</p>
      </div>
      <section className="suite-settings">
        <Tabs activeKey={tab} onChange={setTab} items={[
          { key: 'generate', label: t('ecommerce:workspace.tabs.generate'), children: <GenerationPanel key={slot.id} project={data.project} slot={slot} draft={layerDraft}
            client={client} blocked={blocked || active} flush={flushEditing} onSubmit={quote => workspace.run(() => workspace.submit(quote)).then(() => undefined)} onEdit={patch => slotEditor.edit(slot.id, patch)} flushDraft={() => slotEditor.flushSlot(slot.id)} onError={reportError} /> },
          { key: 'layers', label: t('ecommerce:workspace.tabs.layers'), children: <LayerPanel draft={layerDraft?.value} composition={composition} config={config} selectedId={selectedLayerId}
            locked={mainLocked} disabled={workspace.busy} error={layerDraft?.error} stale={staleDraft} onSelect={setSelectedLayerId} onEdit={patch => slotEditor.edit(slot.id, patch)}
            onSave={() => { void workspace.run(saveComposition).catch(reportError) }} onReset={() => { if (version) void workspace.run(() => slotEditor.reset(slot.id, version)).catch(reportError) }}
            onReadCloud={() => { void workspace.run(() => slotEditor.readCloud(slot.id)).catch(reportError) }}
            onDownloadArchives={() => { void workspace.run(async () => { const saved = await listArchivedSuiteDrafts(actor,id,slot.id); client.assertCurrent(); downloadBlob(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}),t('ecommerce:layers.archiveFilename')) }).catch(reportError) }} /> },
          { key: 'versions', label: t('ecommerce:workspace.tabs.versions'), children: <VersionPanel key={slot.id} client={client} project={data.project} slotId={slot.id} versions={data.versions} disabled={blocked}
            onError={reportError} onSelect={async selected => { await workspace.run(async () => { await flushEditing();
              await client.select(id, slot.id, selected.id, data.project.slotHeads.find(head => head.slotId === slot.id)!.headRevision); await slotEditor.reset(slot.id, selected); await workspace.load() }) }} /> },
        ]} />
        {tab === 'generate' && slot.kind !== 'main' && <div className="suite-upload-controls"><strong>{slot.kind === 'size' ? t('ecommerce:workspace.refHeadingSize') : slot.kind === 'detail' ? t('ecommerce:workspace.refHeadingDetail') : t('ecommerce:workspace.refHeadingScene')}</strong>
          <label className="suite-file-button">{slot.kind === 'detail' ? t('ecommerce:workspace.uploadDetailButton') : t('ecommerce:workspace.uploadRefButton')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked || active} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void workspace.run(() => upload(file, false)).catch(reportError) }} /></label>
          {slot.referenceAssetIds.length > 0 && <><Tag>{t('ecommerce:workspace.savedRefsTag', { count: slot.referenceAssetIds.length })}</Tag><Button size="small" disabled={blocked || active} onClick={() => workspace.edit({ ...config, slots: config.slots.map(item => item.id === slot.id ? { ...item, referenceAssetIds: [] } : item) })}>{t('ecommerce:workspace.removeRefsButton')}</Button></>}
        </div>}
        {(() => {
          const operation = data.operations.filter(op => op.slotId === slot.id).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0]
          const isRunning = Boolean(operation && !operation.terminalState)
          if (isRunning) {
            return <Alert style={{ marginTop: 14 }} type="info" showIcon message={t('ecommerce:workspace.slotRunningAlert')} />
          }
          if (tab !== 'versions' && operation?.appliedVersionIds.some(id => id !== head?.activeVersionId)) {
            return <Alert style={{ marginTop: 14 }} type="success" showIcon message={t('ecommerce:workspace.slotNewVersionAlert')} action={<Button size="small" onClick={() => setTab('versions')}>{t('ecommerce:workspace.viewAlternativesButton')}</Button>} />
          }
          return null
        })()}
      </section>
    </div>
    <div ref={footerRef} className="suite-footer"><span>{t('ecommerce:workspace.footerSlotProgress', { ready: data.project.slotHeads.filter(head => head.activeVersionId && config.slots.some(slot => slot.id === head.slotId && slot.enabled)).length, total: config.slots.filter(slot => slot.enabled).length })}</span>
      <span className="suite-footer-status">{active ? t('ecommerce:workspace.footerStatusActive') : workspace.busy ? t('ecommerce:workspace.footerStatusBusy') : workspace.offline ? t('ecommerce:workspace.footerStatusOffline') : t('ecommerce:workspace.footerStatusAutoSaved')}</span>
      <div className="suite-actions">
        <Button disabled={workspace.busy || workspace.conflict} onClick={() => { void workspace.run(flushEditing).then(() => message.success(workspace.offline ? t('ecommerce:workspace.syncOfflineSuccess') : t('ecommerce:workspace.syncOnlineSuccess'))).catch(reportError) }}>{t('ecommerce:workspace.syncNowButton')}</Button>
        <Button type="primary" disabled={blocked} onClick={() => setExportSelection({})}>{t('ecommerce:workspace.exportButton')}</Button>
      </div></div>
    {exportSelection && <ExportPanel actor={actor} data={data} client={client} signal={signal} initialSlotId={exportSelection.slotId}
      liveKey={JSON.stringify([config, data.project.slotHeads, [...slotEditor.records].map(([id, record]) => [id, record.value])])}
      prepare={prepareExport} onClose={() => setExportSelection(undefined)} />}
    <BatchPanel data={data} disabled={blocked} focusedBatchId={focusedBatchId} onStop={batchId => { void workspace.run(async () => { await client.stop(id, batchId); await workspace.load() }).catch(reportError) }}
      onRetry={selection => { setRetrySelection(selection); setPlanOpen(true) }} />
    {planOpen && <BatchPlanPanel data={data} client={client} retry={retrySelection} blocked={blocked} flush={flushEditing}
      onSubmit={quote => workspace.run(() => workspace.submit(quote)).then(() => undefined)} onClose={() => setPlanOpen(false)} onError={reportError} />}
    <Modal title={t('ecommerce:workspace.bridgeModal.title')} open={bridgeOpen} onCancel={() => setBridgeOpen(false)}
      footer={<Button type="primary" disabled={blocked || !version} loading={workspace.busy} onClick={() => { void workspace.run(openBridge).catch(reportError) }}>{t('ecommerce:workspace.bridgeModal.submitButton')}</Button>}>
      <div className="suite-product-fields"><label>{t('ecommerce:workspace.bridgeModal.toolLabel')}<Select value={bridgeTool} onChange={setBridgeTool} options={(['repaint', 'smart-edit', 'retouch', 'relight'] as const).map(value => ({ value, label: suiteWorkstationToolLabel(value) }))} /></label>
      <label>{t('ecommerce:workspace.bridgeModal.modeLabel')}<Select value={bridgeMode} onChange={setBridgeMode} options={[{ value: 'base', label: t('ecommerce:workspace.bridgeModal.modeBase') }, { value: 'composite', label: t('ecommerce:workspace.bridgeModal.modeComposite') }]} /></label></div>
      <p className="suite-muted">{bridgeMode === 'base' ? t('ecommerce:workspace.bridgeModal.modeBaseHint') : t('ecommerce:workspace.bridgeModal.modeCompositeHint')}</p>
      <p className="suite-muted">{t('ecommerce:workspace.bridgeModal.returnHint')}</p>
    </Modal>
    <Modal title={t('ecommerce:workspace.productModal.title')} open={productOpen} onCancel={() => setProductOpen(false)} width={740} footer={<Button type="primary" loading={workspace.busy} onClick={() => { void workspace.run(async () => { await workspace.flush(); setProductOpen(false) }).then(() => { if (workspace.offline) message.warning(t('ecommerce:workspace.productModal.offlineSavedWarning')) }).catch(reportError) }}>{t('ecommerce:workspace.productModal.saveButton')}</Button>}>
      <ProductFields value={config} onChange={workspace.edit} disabled={workspace.busy} />
      <label className="suite-file-button">{data.assets.some(asset => asset.assetId === config.baseAssetId) ? t('ecommerce:workspace.productModal.replaceBaseButton') : t('ecommerce:workspace.productModal.uploadBaseButton')}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={blocked || active} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void workspace.run(() => upload(file, true)).catch(reportError) }} /></label>
    </Modal>
  </div>
}
