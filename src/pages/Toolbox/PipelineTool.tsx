import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Progress, Radio, Segmented, Spin, Switch, Tooltip } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { useUserStore } from '@/store/useUserStore'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import { usePipelineStore } from '@/features/toolbox-pipeline/store'
import { initializePipeline, pausePipeline, startPipeline, forgetPipelineImage, clearPipelineCache } from '@/features/toolbox-pipeline/runtime'
import { finalMime, itemStatus, type PipelineItem, type PipelineSettings } from '@/features/toolbox-pipeline/types'
import { pipelineQueueNote } from '@/features/toolbox-pipeline/notices'
import ResultGallery from './shared/ResultGallery'
import ResultGrid, { type ResultFilter } from './shared/ResultGrid'
import { footerMode, progressLabel } from './shared/resultProgress'
import { unavailableCropSummary } from './aspect-ratio/subjectFocus'
import { pipelineNames, createPipelineZip } from '@/features/toolbox-pipeline/download'
import { usePipelineUrls } from '@/features/toolbox-pipeline/usePipelineUrls'
import { usePipelinePreview, type PreviewStage } from '@/features/toolbox-pipeline/usePipelinePreview'
import ToolboxImageCard, { PreviewItemNotice, PreviewResultActions } from './ToolboxImageCard'
import AspectRatioSettingsPanel from './shared/AspectRatioSettingsPanel'
import WatermarkSettingsPanel from './shared/WatermarkSettingsPanel'
import PresetControls from './shared/PresetControls'
import { inspectImage, inspectLogo, queueLimitMessage, MAX_ZIP_BYTES } from './shared/inspect'
import { hasWatermark } from './watermark/validation'
import * as ratioPresets from './aspect-ratio/presets'
import * as watermarkPresets from './watermark/presets'
import type { AspectRatioSettings, FitStrategy } from './aspect-ratio/types'
import { downloadBlob } from './shared/zip'
import { datedDownloadName } from './shared/dateStamp'

const ratioApi = { list: ratioPresets.listPresets, save: ratioPresets.savePreset, remove: ratioPresets.deletePreset }
const watermarkApi = { list: watermarkPresets.listPresets, save: watermarkPresets.savePreset, remove: watermarkPresets.deletePreset }
const allowedStrategies: FitStrategy[] = ['letterbox', 'crop']
const acceptsRatio = (settings: AspectRatioSettings) => settings.strategy !== 'outpaint'
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败'

interface SettingsSnapshot {
  items: PipelineItem[]
  settings: PipelineSettings
  selectedId: string | null
  count: number
}

export default function PipelineTool() {
  const { message, modal } = App.useApp()
  const state = usePipelineStore()
  const ownerId = useUserStore(user => user.userId ?? 'local')
  const { items, settings, selectedId, runState, stopping } = state
  const [stage, setStage] = useState<PreviewStage>('final')
  const [resultView, setResultView] = useState<'single' | 'grid'>('single')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const [settingsNotice, setSettingsNotice] = useState<{ count: number } | null>(null)
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null)
  const removedRef = useRef<{ item: PipelineItem; index: number; timer: number } | null>(null)
  const previewPanelRef = useRef<HTMLElement | null>(null)
  const pending = useRef({ count: 0, bytes: 0 })
  const additions = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(false)
  const processing = runState === 'running' || stopping
  const paused = runState === 'paused'
  const busy = processing || adding || packaging
  const urls = usePipelineUrls(items)
  const selected = items.find(item => item.id === selectedId)
  const preview = usePipelinePreview(selected, settings, stage, processing)
  const completed = items.filter(item => itemStatus(item) === 'succeeded')
  const failed = items.filter(item => itemStatus(item) === 'failed')
  const pendingItems = items.filter(item => itemStatus(item) === 'pending')
  const allDone = items.length > 0 && completed.length === items.length
  const mode = footerMode({ processing, itemCount: items.length, allDone, failedCount: failed.length })
  const donePercent = items.length ? Math.round(completed.length / items.length * 100) : 0
  const gallerySources = useMemo(() => items.map(item => ({ id: item.id, file: item.file, sourceUrl: urls.get(item.file) ?? '', output: item.output?.blob })), [items, urls])
  const ratioSources = useMemo(() => items.map(item => ({ id: item.id, file: item.file, sourceUrl: urls.get(item.file) ?? '', output: item.intermediate?.blob })), [items, urls])
  const finalGallery = useBlobPreviewGallery(gallerySources)
  const ratioGallery = useBlobPreviewGallery(ratioSources)
  const preset = PLATFORM_SIZE_PRESETS.find(preset => preset.id === settings.aspectRatio.selectedPresetId)!
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.blob.size ?? 0), 0)
  const watermarkValid = !settings.watermarkEnabled || hasWatermark(settings.watermark)
  const degradeLabel = unavailableCropSummary(completed.map(item => item.cropFocus))
  const missedSubjectCount = completed.filter(item => item.cropFocus?.source === 'grid' && !item.cropFocus.unavailable).length
  const failedSelected = Boolean(selected && itemStatus(selected) === 'failed')
  const processingSelected = Boolean(selected && itemStatus(selected) === 'processing')
  const shownArtifact = stage === 'ratio' ? selected?.intermediate : stage === 'final' ? selected?.output : undefined
  const shownSize = stage === 'original' && selected ? selected : shownArtifact ?? preset
  // 失败项必须回到源图，避免把计划中的预览当成可交付结果。
  const shownUrl = failedSelected && selected
    ? urls.get(selected.file)
    : preview?.url ?? (shownArtifact ? urls.get(shownArtifact.blob) : undefined) ?? (selected ? urls.get(selected.file) : undefined)
  const stageLabel = stage === 'original' ? '原图' : stage === 'ratio' ? '转比例结果' : '最终效果'
  const stageMime = stage === 'original'
    ? selected?.sourceMime
    : stage === 'ratio'
      ? selected?.intermediate?.mimeType ?? (settings.aspectRatio.strategy === 'letterbox' && settings.aspectRatio.background === 'transparent' ? 'image/png' : 'image/jpeg')
      : selected ? finalMime(selected, settings) : undefined
  const shownFromSource = Boolean(selected) && (failedSelected || (!shownArtifact && !preview?.url))
  const previewAltText = selected ? `${selected.file.name} 的${shownFromSource ? '原图' : stageLabel}` : ''
  const checkerboard = settings.aspectRatio.strategy === 'letterbox' && settings.aspectRatio.background === 'transparent'
  const canOpenResult = Boolean(selected && shownArtifact && !failedSelected && !processingSelected)
  const activeGallery = stage === 'ratio' ? ratioGallery : stage === 'final' ? finalGallery : null
  const gridById = new Map(activeGallery?.galleryProps.items.map(item => [item.id, item]) ?? [])
  const previewMetaText = resultView === 'grid'
    ? `结果网格 · ${stageLabel} · 成功 ${completed.length} · 失败 ${failed.length}`
    : selected
      ? `${selected.file.name} · ${shownSize.width} × ${shownSize.height}${stageMime ? ` · ${stageMime === 'image/png' ? 'PNG' : 'JPEG'}` : ''}`
      : `${preset.label} · ${shownSize.width} × ${shownSize.height}`
  const statusText = progressLabel({ itemCount: items.length, completedCount: completed.length, failedCount: failed.length, processing })
    + (degradeLabel ? ` · ${degradeLabel}` : '')
    + (paused ? ' · 已暂停' : '')
  const downloadActionLabel = completed.length > 0 && failed.length > 0 ? `下载 ${completed.length} 张结果` : '打包下载'
  // 失败项全部恢复后按“全部”展示，避免网格停在空结果；派生值不触发额外渲染。
  const shownResultFilter: ResultFilter = resultFilter === 'failed' && failed.length === 0 ? 'all' : resultFilter

  useEffect(() => {
    mounted.current = true
    initializePipeline()
    return () => { mounted.current = false; pausePipeline() }
  }, [ownerId])

  useEffect(() => {
    if (!items.length) return
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [items.length])

  useEffect(() => () => {
    if (removedRef.current) window.clearTimeout(removedRef.current.timer)
  }, [])

  function clearSettingsNotice() {
    settingsSnapshotRef.current = null
    setSettingsNotice(null)
  }

  function captureSettingsChange() {
    if (settingsSnapshotRef.current) return
    const current = usePipelineStore.getState()
    const count = current.items.filter(item => itemStatus(item) === 'succeeded').length
    if (count === 0) return
    settingsSnapshotRef.current = { items: current.items, settings: current.settings, selectedId: current.selectedId, count }
    setSettingsNotice({ count })
  }

  function undoSettingsChange() {
    const snapshot = settingsSnapshotRef.current
    if (!snapshot) return
    state.restore({ items: snapshot.items, settings: snapshot.settings, selectedId: snapshot.selectedId })
    clearSettingsNotice()
  }

  function discardRemoveUndo() {
    const removed = removedRef.current
    if (!removed) return
    window.clearTimeout(removed.timer)
    forgetPipelineImage(removed.item.file)
    removedRef.current = null
    message.destroy('pipeline-remove')
  }

  function undoRemove() {
    const removed = removedRef.current
    if (!removed) return
    window.clearTimeout(removed.timer)
    state.restoreItem(removed.item, removed.index)
    state.select(removed.item.id)
    removedRef.current = null
    message.destroy('pipeline-remove')
  }

  function updateRatio(patch: Partial<AspectRatioSettings>) {
    if (busy || patch.strategy === 'outpaint') return
    const next = { ...patch, strategy: patch.strategy ?? settings.aspectRatio.strategy }
    const changed = Object.entries(next).some(([key, value]) => !Object.is(settings.aspectRatio[key as keyof AspectRatioSettings], value))
    if (!changed) return
    discardRemoveUndo()
    captureSettingsChange()
    state.updateRatio(next)
  }

  function updateWatermark(patch: Partial<PipelineSettings['watermark']>) {
    if (busy) return
    const changed = Object.entries(patch).some(([key, value]) => !Object.is(settings.watermark[key as keyof PipelineSettings['watermark']], value))
    if (!changed) return
    discardRemoveUndo()
    captureSettingsChange()
    state.updateWatermark(patch)
  }

  function enableWatermark(enabled: boolean) {
    if (busy || settings.watermarkEnabled === enabled) return
    discardRemoveUndo()
    captureSettingsChange()
    state.enableWatermark(enabled)
  }

  function scrollToPreview() {
    window.requestAnimationFrame(() => previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  function showResult() {
    setStage('final')
    setResultView(completed.length > 4 || failed.length > 0 ? 'grid' : 'single')
    setResultFilter('all')
    scrollToPreview()
  }

  function showFailed() {
    setStage('final')
    setResultView('grid')
    setResultFilter('failed')
    scrollToPreview()
  }

  function addFile(file: File) {
    if (processing || packaging) return
    clearSettingsNotice()
    discardRemoveUndo()
    const current = usePipelineStore.getState()
    const blocked = queueLimitMessage(file, current.items.length + pending.current.count,
      current.items.reduce((sum, item) => sum + item.file.size, 0) + pending.current.bytes)
    if (blocked) { message.error(blocked); return }
    pending.current.count++; pending.current.bytes += file.size; setAdding(true)
    const revision = current.revision
    const owner = current.ownerId
    additions.current = additions.current.then(async () => {
      const inspected = await inspectImage(file)
      const next = usePipelineStore.getState()
      if (!mounted.current || next.ownerId !== owner || next.revision !== revision) return
      next.add({ id: crypto.randomUUID(), file, sourceMime: inspected.mimeType, width: inspected.width,
        height: inspected.height, ratioStatus: 'pending', watermarkStatus: 'pending' })
    }).catch(error => {
      if (mounted.current && usePipelineStore.getState().ownerId === owner) message.error(`${file.name}：${errorMessage(error)}`)
    }).finally(() => {
      pending.current.count--; pending.current.bytes -= file.size
      if (mounted.current && pending.current.count === 0) setAdding(false)
    })
  }

  async function process(ids?: string[]) {
    if (busy) return
    clearSettingsNotice()
    discardRemoveUndo()
    try {
      await startPipeline(ids)
      if (!mounted.current) return
      const latest = usePipelineStore.getState()
      // 只有整批处理结束才自动跳到失败项；单张/失败项重试保持当前选中。
      if (ids || latest.runState === 'paused') return
      const firstFailed = latest.items.find(item => itemStatus(item) === 'failed')
      if (firstFailed) latest.select(firstFailed.id)
    } catch (error) { if (mounted.current) message.error(errorMessage(error)) }
  }

  async function chooseLogo(file: File) {
    const owner = usePipelineStore.getState().ownerId
    const revision = usePipelineStore.getState().revision
    try {
      await inspectLogo(file)
      if (mounted.current && usePipelineStore.getState().ownerId === owner && usePipelineStore.getState().revision === revision) updateWatermark({ logo: file, logoName: file.name })
    } catch (error) { if (mounted.current && usePipelineStore.getState().ownerId === owner) message.error(errorMessage(error)) }
  }

  function removeFile(id: string) {
    const current = usePipelineStore.getState()
    const index = current.items.findIndex(item => item.id === id)
    const item = current.items[index]
    if (!item) return
    clearSettingsNotice()
    discardRemoveUndo()
    current.remove(id)
    const timer = window.setTimeout(() => {
      forgetPipelineImage(item.file)
      if (removedRef.current?.item.id === item.id) removedRef.current = null
    }, 6000)
    removedRef.current = { item, index, timer }
    message.open({
      key: 'pipeline-remove',
      type: 'info',
      duration: 5,
      content: (
        <span>
          已移除 1 张图片
          <Button type="link" size="small" autoInsertSpace={false} className="toolbox-undo-button" onClick={undoRemove}>撤销</Button>
        </span>
      ),
    })
  }

  function requestClear() {
    if (busy) return
    modal.confirm({
      title: '清空全部图片？',
      content: '队列和已生成的结果都会被移除，此操作不可撤销。',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      autoFocusButton: 'cancel',
      onOk: () => {
        clearSettingsNotice()
        discardRemoveUndo()
        clearPipelineCache()
        state.clear()
      },
    })
  }

  function downloadOne(id: string) {
    const current = usePipelineStore.getState()
    const item = current.items.find(item => item.id === id)
    if (!item?.output) return
    try { downloadBlob(item.output.blob, pipelineNames(current.items.filter(item => itemStatus(item) === 'succeeded'), current.settings).get(id)!) }
    catch (error) { message.error(errorMessage(error)) }
  }

  async function downloadAll() {
    if (busy) return
    const current = usePipelineStore.getState()
    setPackaging(true)
    try {
      const zip = await createPipelineZip(current.items, current.settings)
      if (mounted.current && usePipelineStore.getState().ownerId === current.ownerId && usePipelineStore.getState().revision === current.revision) downloadBlob(zip, `${datedDownloadName(`pipeline_${preset.id}`)}.zip`)
    } catch (error) { if (mounted.current && usePipelineStore.getState().ownerId === current.ownerId) message.error(errorMessage(error)) }
    finally { if (mounted.current) setPackaging(false) }
  }

  return <div className="toolbox-watermark toolbox-pipeline toolbox-sticky-preview">
    <h1 className="sr-only">流水线</h1>
    <div className="toolbox-pipeline-lead">
      <div className="toolbox-section-heading"><div><strong>转比例 → 加水印</strong><span>一次设置，自动处理整批图片</span></div></div>
      <ToolboxImageCard
        items={items.map(item => {
          const artifact = item.output ?? item.intermediate
          return {
            id: item.id,
            name: item.file.name,
            url: urls.get(artifact?.blob ?? item.file) ?? '',
            status: itemStatus(item),
            error: item.error,
            note: pipelineQueueNote(item, runState),
          }
        })}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={state.select}
        onRemove={removeFile}
        onClear={requestClear}
        processingHint={settings.aspectRatio.strategy === 'crop' ? '主体识别可能上传缩略图，水印在本机处理' : '转比例与水印在本机处理'}
      />
    </div>
    <div className="toolbox-watermark-main">
      <section ref={previewPanelRef} className={`toolbox-preview-panel${selected && resultView === 'single' ? ' has-image' : ''}`} aria-label="流水线预览">
        <div className="toolbox-section-heading">
          <div className="toolbox-preview-title">
            <strong>效果预览</strong>
            <span className="toolbox-preview-meta">{previewMetaText}</span>
          </div>
          <div className="toolbox-preview-actions">
            {items.length > 0 && (
              <Segmented
                size="small"
                aria-label="结果视图"
                value={resultView}
                options={[{ label: '单张', value: 'single' }, { label: '结果网格', value: 'grid' }]}
                onChange={value => { setResultView(value === 'grid' ? 'grid' : 'single'); setResultFilter('all') }}
              />
            )}
            {selected && resultView === 'single' && (
              <PreviewResultActions
                status={itemStatus(selected)}
                hasOutput={Boolean(selected.output)}
                retry={itemStatus(selected) === 'succeeded' && selected.cropFocus?.source === 'grid'}
                busy={busy}
                onDownload={() => downloadOne(selected.id)}
                onRetry={() => { void process([selected.id]) }}
              />
            )}
          </div>
        </div>
        <div className="toolbox-stage-switch" role="radiogroup" aria-label="预览阶段">
          <Radio.Group value={stage} onChange={event => setStage(event.target.value)} optionType="button" buttonStyle="solid"
            options={[{ label: '原图', value: 'original' }, { label: '转比例', value: 'ratio' }, { label: '最终效果', value: 'final' }]} />
        </div>
        {resultView === 'single' && selected && (
          <PreviewItemNotice
            error={selected.error}
            note={pipelineQueueNote(selected, runState)}
            warning={selected.cropFocus?.source === 'grid' && pipelineQueueNote(selected, runState) === selected.cropFocus.note}
          />
        )}
        {resultView === 'grid' ? (
          <ResultGrid
            items={items.map(item => ({ id: item.id, name: item.file.name, sourceUrl: urls.get(item.file) ?? '', status: itemStatus(item) }))}
            results={gridById}
            selectedId={selectedId}
            filter={shownResultFilter}
            onFilterChange={setResultFilter}
            onSelect={id => { state.select(id); setResultView('single') }}
            ariaLabel="流水线结果网格"
            checkerboard={checkerboard}
            compact={items.length <= 4}
          />
        ) : (
          <div className={`toolbox-preview-stage${checkerboard ? ' is-transparent' : ''}`}>
            {selected && shownUrl ? (
              <>
                <img
                  src={shownUrl}
                  alt={previewAltText}
                  tabIndex={canOpenResult ? 0 : undefined}
                  role={canOpenResult ? 'button' : undefined}
                  aria-label={canOpenResult ? `打开${stageLabel}大图` : undefined}
                  onClick={canOpenResult ? () => activeGallery?.openAt(selected.id) : undefined}
                  onKeyDown={canOpenResult ? event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    activeGallery?.openAt(selected.id)
                  } : undefined}
                  style={{ cursor: canOpenResult ? 'zoom-in' : undefined }}
                />
                {failedSelected && (
                  <div className="toolbox-preview-state is-failed">
                    <span>{selected.failedStep === 'watermark' ? '加水印失败，可重试' : '转比例失败，可重试'}</span>
                  </div>
                )}
                {processingSelected && !failedSelected && (
                  <div className="toolbox-preview-state is-processing" role="status">
                    <Spin size="small" />
                    <span>正在处理…</span>
                  </div>
                )}
              </>
            ) : <p>{selected ? '正在准备预览…' : '先添加图片，再配置转比例和水印'}</p>}
          </div>
        )}
        {preview?.loading && <p className="toolbox-hint" role="status">正在更新预览…</p>}
        {preview?.error && <p className="toolbox-preview-error">预览失败：{preview.error}</p>}
        {resultView === 'grid' && <p className="toolbox-hint">点击任意结果查看单张大图。</p>}
        <p className="toolbox-hint toolbox-preview-spec">预览最长边不超过 800 px，成品按平台精确尺寸导出。切页会暂停，返回后可继续；刷新或关闭后需重新上传。</p>
        {settings.aspectRatio.strategy === 'crop' && !selected?.intermediate && <p className="toolbox-hint">预览按九宫格展示；处理时识别主体，实际裁剪位置可能调整。</p>}
        {!watermarkValid && <p className="toolbox-hint toolbox-warning">请先填写水印文字或选择 Logo，也可以关闭水印。</p>}
        {runState === 'paused' && <p className="toolbox-hint" role="status">{stopping ? '正在暂停处理…' : '已暂停，成功步骤已保留，可继续处理。'}</p>}
      </section>
      <div className="toolbox-pipeline-settings">
        <AspectRatioSettingsPanel settings={settings.aspectRatio} disabled={busy} onChange={updateRatio} allowedStrategies={allowedStrategies}
          templates={<PresetControls key={ownerId} scope={ownerId} settings={settings.aspectRatio as AspectRatioSettings} api={ratioApi} disabled={busy} onApply={updateRatio} accepts={acceptsRatio} />} />
        <div className="toolbox-pipeline-watermark-toggle"><strong>加水印</strong><Switch checked={settings.watermarkEnabled} disabled={busy} aria-label="启用水印" onChange={enableWatermark} /></div>
        {settings.watermarkEnabled && <WatermarkSettingsPanel settings={settings.watermark} disabled={busy} onChange={updateWatermark} onLogo={chooseLogo}
          templates={<PresetControls key={ownerId} scope={ownerId} settings={settings.watermark} api={watermarkApi} disabled={busy} onApply={updateWatermark} validate={() => hasWatermark(settings.watermark)} />} />}
      </div>
    </div>
    <ResultGallery {...finalGallery.galleryProps} downloadLabel="下载流水线成品" downloadTooltip="下载最终效果" resultLabel="最终效果"
      checkerboard={checkerboard} onDownload={item => downloadOne(item.id)} />
    <ResultGallery {...ratioGallery.galleryProps} downloadLabel="下载转比例结果" downloadTooltip="下载转比例结果" resultLabel="转比例结果"
      checkerboard={checkerboard} onDownload={item => {
        const intermediate = items.find(candidate => candidate.id === item.id)?.intermediate
        if (!intermediate) return
        try {
          const candidates = items.filter(candidate => candidate.intermediate).map(candidate => ({ ...candidate, output: candidate.intermediate }))
          downloadBlob(intermediate.blob, pipelineNames(candidates, { ...settings, watermarkEnabled: false }).get(item.id)!)
        } catch (error) { message.error(errorMessage(error)) }
      }} />
    <div className="toolbox-watermark-footer">
      {degradeLabel && <p className="toolbox-crop-notice toolbox-crop-warning" role="status">{degradeLabel}。可在对应图片上单独重试。</p>}
      {missedSubjectCount > 0 && <p className="toolbox-crop-notice toolbox-crop-warning" role="status">{missedSubjectCount} 张没识别到商品，已按当前九宫格裁剪。</p>}
      <div className="toolbox-progress" role="status" aria-live="polite">
        <span>{statusText}</span>
        {processing && <Progress size="small" aria-label="处理进度" percent={Math.max(donePercent, 8)} showInfo={false} />}
        {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
        {settingsNotice && (
          <span className="toolbox-undo-notice">
            设置已更改，已清除 {settingsNotice.count} 张已完成结果
            <Button type="link" size="small" autoInsertSpace={false} className="toolbox-undo-button" onClick={undoSettingsChange}>撤销</Button>
          </span>
        )}
      </div>
      <div className="toolbox-footer-actions">
        <Button type={mode === 'download' ? 'primary' : 'default'} icon={<DownloadOutlined />} disabled={!completed.length || busy || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>{downloadActionLabel}</Button>
        {mode === 'download' && <Button type="link" className="toolbox-view-result" onClick={showResult}>查看结果</Button>}
        {mode === 'retry' && (
          <>
            <Button type="primary" disabled={busy || !watermarkValid} onClick={() => void process(failed.map(item => item.id))}>重试失败项</Button>
            {pendingItems.length > 0 && <Button disabled={busy || !watermarkValid} onClick={() => void process(pendingItems.map(item => item.id))}>继续处理剩余</Button>}
            <Button type="link" className="toolbox-view-result" onClick={showFailed}>查看失败项</Button>
          </>
        )}
        {mode === 'cancel' && <Button onClick={pausePipeline}>暂停处理</Button>}
        {(mode === 'process' || mode === 'empty') && (
          <Tooltip title={!watermarkValid ? '请先填写水印文字或选择 Logo' : mode === 'empty' ? '请先添加图片' : undefined}>
            <span>
              <Button type="primary" disabled={busy || !watermarkValid || !items.some(item => itemStatus(item) !== 'succeeded')} onClick={() => void process()}>{paused ? '继续处理' : '开始处理'}</Button>
            </span>
          </Tooltip>
        )}
      </div>
    </div>
  </div>
}
