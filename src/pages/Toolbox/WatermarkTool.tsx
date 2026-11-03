import { useEffect, useRef, useState, type FocusEvent as ReactFocusEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { App, Button, Input, Progress, Segmented, Select } from 'antd'
import { DownloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useUserStore } from '@/store/useUserStore'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import WatermarkSettingsPanel from './shared/WatermarkSettingsPanel'
import ResultGallery from './shared/ResultGallery'
import ResultGrid, { type ResultFilter } from './shared/ResultGrid'
import ToolboxImageCard, { PreviewItemNotice, PreviewResultActions } from './ToolboxImageCard'
import { invalidateBatch, processBatch } from './watermark/batch'
import { createWatermarkZip, downloadBlob, namesForImages } from './watermark/download'
import { deletePreset, listPresets, savePreset, type WatermarkPreset } from './watermark/presets'
import { WatermarkRenderer } from './watermark/renderer'
import { type BatchImage, type WatermarkSettings } from './watermark/types'
import { watermarkPreviewAlt, watermarkPreviewMeta, watermarkPreviewSource, type WatermarkPreviewMode } from './watermark/preview'
import { datedDownloadName } from './shared/dateStamp'
import { LOCAL_TEMPLATE_LABEL } from './shared/presetLabels'
import { inspectImage, inspectLogo, MAX_ZIP_BYTES, queueLimitMessage, hasWatermark } from './watermark/validation'
import { usePreferencesStore } from '@/features/preferences/store'
import { initialWatermarkSettings, watermarkMemory } from '@/features/preferences/toolParameters'


function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}


interface PreviewState {
  imageId: string
  settings: WatermarkSettings
  loading: boolean
  url?: string
  error?: string
}

interface SettingsSnapshot {
  items: BatchImage[]
  settings: WatermarkSettings
  selectedPresetId: string | null
}

type ResultView = 'single' | 'grid'

export default function WatermarkTool() {
  const { message, modal } = App.useApp()
  const scope = useUserStore(state => state.userId ?? 'local')
  const [items, setItems] = useState<BatchImage[]>([])
  const { openAt, galleryProps } = useBlobPreviewGallery(items)
  const itemsRef = useRef<BatchImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resultView, setResultView] = useState<ResultView>('single')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [previewMode, setPreviewMode] = useState<WatermarkPreviewMode>('result')
  const memoryEpoch = usePreferencesStore(state => state.memoryEpoch)
  const [settings, setSettings] = useState<WatermarkSettings>(() => initialWatermarkSettings(usePreferencesStore.getState().preferences))
  const [appliedMemoryEpoch, setAppliedMemoryEpoch] = useState(memoryEpoch)
  if (appliedMemoryEpoch !== memoryEpoch) {
    setSettings(initialWatermarkSettings(usePreferencesStore.getState().preferences))
    setAppliedMemoryEpoch(memoryEpoch)
  }
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const cancelledRef = useRef(false)
  const mountedRef = useRef(true)
  const rendererRef = useRef<WatermarkRenderer | null>(null)
  const addChainRef = useRef<Promise<void>>(Promise.resolve())
  const addingCountRef = useRef(0)
  const pendingBytesRef = useRef(0)
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const [presets, setPresets] = useState<WatermarkPreset[]>([])
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [presetName, setPresetName] = useState('')
  const [settingsNotice, setSettingsNotice] = useState<{ count: number } | null>(null)
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null)
  const previewScrollTopRef = useRef<number | null>(null)

  const selected = items.find(item => item.id === selectedId)
  const completed = items.filter(item => item.status === 'succeeded')
  const failed = items.filter(item => item.status === 'failed')
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
  const busy = processing || adding || packaging
  const controlsLocked = processing || packaging
  const currentPreview = selected && !processing && previewState?.imageId === selected.id && previewState.settings === settings ? previewState : null
  const galleryById = new Map(galleryProps.items.map(item => [item.id, item]))
  const selectedResult = selected ? galleryById.get(selected.id) : undefined
  const hasResult = Boolean(selected?.output)
  const resultUrl = hasResult ? selectedResult?.fullSrc : undefined
  const previewSrc = selected
    ? watermarkPreviewSource({ mode: previewMode, resultUrl, previewUrl: currentPreview?.url, sourceUrl: selected.sourceUrl })
    : null
  const previewAltText = selected ? watermarkPreviewAlt({ mode: previewMode, name: selected.file.name, hasResult }) : ''
  const previewMetaText = hasResult ? watermarkPreviewMeta({ mode: previewMode, hasResult }) : null
  const canOpenResult = Boolean(selected?.output && selectedResult) && previewMode === 'result' && resultView === 'single'
  const batchSummary = items.length > 0
    ? `成功 ${completed.length} · 失败 ${failed.length} · 可下载 ${completed.length}`
    : '等待图片'

  function commitItems(next: BatchImage[]) {
    if (!mountedRef.current) return
    itemsRef.current = next
    setItems(next)
  }

  function replacePreview(next: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = next
  }

  function renderer() {
    if (!rendererRef.current) rendererRef.current = new WatermarkRenderer()
    return rendererRef.current
  }

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      rendererRef.current?.dispose()
      rendererRef.current = null
      for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  useEffect(() => {
    let active = true
    void listPresets(scope).then(records => {
      if (active) setPresets(records)
    }).catch(error => { if (active) message.warning(`读取本机模板失败：${errorMessage(error)}`) })
    return () => { active = false }
  }, [scope, message])

  useEffect(() => {
    let cancelled = false
    let previewRenderer: WatermarkRenderer | null = null
    if (!selected || !hasWatermark(settings)) {
      replacePreview(null)
      return
    }
    if (processing) return
    const timer = window.setTimeout(() => {
      setPreviewState({ imageId: selected.id, settings, loading: true })
      previewRenderer = new WatermarkRenderer()
      void previewRenderer.render({ file: selected.file, sourceMime: selected.sourceMime, settings, previewMaxDimension: 1000 })
        .then(result => {
          const url = URL.createObjectURL(result.blob)
          if (cancelled || !mountedRef.current) URL.revokeObjectURL(url)
          else {
            replacePreview(url)
            setPreviewState({ imageId: selected.id, settings, loading: false, url })
          }
        })
        .catch(error => {
          if (!cancelled && mountedRef.current) setPreviewState({ imageId: selected.id, settings, loading: false, error: errorMessage(error) })
        })
        .finally(() => {
          previewRenderer?.dispose()
          previewRenderer = null
        })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer); previewRenderer?.dispose() }
  }, [selected, settings, processing])

  function clearSettingsNotice() {
    setSettingsNotice(null)
    settingsSnapshotRef.current = null
  }

  function updateSettings(patch: Partial<WatermarkSettings>) {
    if (processingRef.current || packaging) return
    const next = { ...settings, ...patch }
    const completedCount = itemsRef.current.filter(item => item.status === 'succeeded').length
    if (completedCount > 0 && !settingsNotice) {
      settingsSnapshotRef.current = { items: itemsRef.current, settings, selectedPresetId }
      setSettingsNotice({ count: completedCount })
    }
    setSettings(next)
    usePreferencesStore.getState().remember('watermark', watermarkMemory(next))
    setSelectedPresetId(null)
    setPreviewMode('result')
    if (itemsRef.current.some(item => item.status !== 'pending')) {
      commitItems(invalidateBatch(itemsRef.current))
    }
  }

  function undoSettingsChange() {
    const snapshot = settingsSnapshotRef.current
    if (!snapshot) return
    commitItems(snapshot.items)
    setSettings(snapshot.settings)
    usePreferencesStore.getState().remember('watermark', watermarkMemory(snapshot.settings))
    setSelectedPresetId(snapshot.selectedPresetId)
    setPreviewMode('result')
    clearSettingsNotice()
  }

  function addFile(file: File) {
    if (processingRef.current) return
    const queuedBytes = itemsRef.current.reduce((sum, item) => sum + item.file.size, 0) + pendingBytesRef.current
    const blocked = queueLimitMessage(file, itemsRef.current.length + addingCountRef.current, queuedBytes)
    if (blocked) { message.error(blocked); return }
    addingCountRef.current += 1
    pendingBytesRef.current += file.size
    setAdding(true)
    addChainRef.current = addChainRef.current.then(async () => {
      const inspected = await inspectImage(file)
      if (!mountedRef.current) return
      const item: BatchImage = {
        id: crypto.randomUUID(), file, sourceMime: inspected.mimeType,
        sourceUrl: URL.createObjectURL(file), width: inspected.width, height: inspected.height,
        status: 'pending',
      }
      clearSettingsNotice()
      commitItems([...itemsRef.current, item])
      setSelectedId(current => current ?? item.id)
    }).catch(error => {
      if (mountedRef.current) message.error(`${file.name}：${errorMessage(error)}`)
    }).finally(() => {
      addingCountRef.current -= 1
      pendingBytesRef.current -= file.size
      if (mountedRef.current && addingCountRef.current === 0) setAdding(false)
    })
  }

  function removeFile(id: string) {
    if (processingRef.current) return
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (item) URL.revokeObjectURL(item.sourceUrl)
    const next = itemsRef.current.filter(candidate => candidate.id !== id)
    clearSettingsNotice()
    commitItems(next)
    if (!next.length) {
      setResultView('single')
      setResultFilter('all')
      setPreviewMode('result')
    } else if (selectedId === id) {
      setPreviewMode('result')
    }
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }

  function selectImage(id: string) {
    setSelectedId(id)
    setResultView('single')
    setPreviewMode('result')
  }

  // Ant Segmented 的隐藏 radio 位于吸顶预览里，聚焦时浏览器会按它的布局位置滚动到页面顶部。
  // 在指针按下时记住位置，聚焦后恢复，避免切换单张/网格或结果/原图时页面跳动。
  function rememberPreviewScroll(event: ReactPointerEvent<HTMLDivElement>) {
    if (!(event.target as Element).closest('.ant-segmented')) return
    const main = document.querySelector<HTMLElement>('.app-main-content')
    previewScrollTopRef.current = main?.scrollTop ?? null
  }

  function restorePreviewScroll(event: ReactFocusEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof HTMLInputElement) || !target.classList.contains('ant-segmented-item-input')) return
    const top = previewScrollTopRef.current
    if (top == null) return
    previewScrollTopRef.current = null
    const main = document.querySelector<HTMLElement>('.app-main-content')
    if (!main) return
    requestAnimationFrame(() => {
      if (mountedRef.current && main.isConnected) main.scrollTop = top
    })
  }

  function clearFiles() {
    if (processingRef.current) return
    for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
    clearSettingsNotice()
    commitItems([])
    setSelectedId(null)
    setResultView('single')
    setResultFilter('all')
    setPreviewMode('result')
    replacePreview(null)
  }

  function requestClearFiles() {
    if (processingRef.current || !itemsRef.current.length) return
    const count = itemsRef.current.length
    modal.confirm({
      title: '清空全部图片？',
      content: `将移除 ${count} 张图片及其已完成结果，此操作不可撤销。`,
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      autoFocusButton: 'cancel',
      onOk: clearFiles,
    })
  }

  async function processImages(onlyIds?: string[]) {
    if (processingRef.current || addingCountRef.current || !hasWatermark(settings)) return
    const targets = itemsRef.current.filter(item => (onlyIds ? onlyIds.includes(item.id) : item.status !== 'succeeded'))
    if (!targets.length) return
    clearSettingsNotice()
    setPreviewMode('result')
    processingRef.current = true
    cancelledRef.current = false
    setProcessing(true)
    try {
      await processBatch({
        images: itemsRef.current,
        settings,
        ids: onlyIds,
        render: request => renderer().render(request),
        update: (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
        shouldStop: () => cancelledRef.current || !mountedRef.current,
      })
      if (mountedRef.current && !cancelledRef.current && itemsRef.current.some(item => item.status === 'succeeded' && item.outputMime !== item.sourceMime)) {
        message.warning('当前浏览器不支持部分原格式编码，相关图片已按实际格式导出')
      }
    } finally {
      processingRef.current = false
      if (mountedRef.current) {
        commitItems(itemsRef.current.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item))
        setProcessing(false)
      }
    }
  }

  function cancelProcessing() {
    cancelledRef.current = true
    rendererRef.current?.dispose()
    rendererRef.current = null
  }

  function downloadOne(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item?.output) return
    const names = namesForImages(itemsRef.current.filter(candidate => candidate.status === 'succeeded'))
    downloadBlob(item.output, names.get(id)!)
  }

  async function downloadAll() {
    if (packaging) return
    setPackaging(true)
    try {
      const blob = await createWatermarkZip(itemsRef.current)
      downloadBlob(blob, `${datedDownloadName('watermarked')}.zip`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      if (mountedRef.current) setPackaging(false)
    }
  }

  async function chooseLogo(file: File) {
    try {
      await inspectLogo(file)
      updateSettings({ logo: file, logoName: file.name })
    } catch (error) {
      message.error(errorMessage(error))
    }
  }

  async function saveCurrentPreset() {
    const name = presetName.trim()
    if (!name) { message.warning('请先输入模板名称'); return }
    if (!hasWatermark(settings)) { message.warning('请先设置水印内容'); return }
    if (presets.some(preset => preset.name === name)) { message.warning('模板名称已存在'); return }
    try {
      const preset = await savePreset(scope, name, settings)
      setPresets(current => [preset, ...current])
      setSelectedPresetId(preset.id)
      setPresetName('')
      message.success('模板已保存在本机')
    } catch (error) { message.error(errorMessage(error)) }
  }

  function choosePreset(id: string) {
    const preset = presets.find(item => item.id === id)
    if (!preset) return
    updateSettings(preset.settings)
    setSelectedPresetId(id)
  }

  function requestRemovePreset() {
    const preset = presets.find(item => item.id === selectedPresetId)
    if (!preset) return
    modal.confirm({
      title: '删除本机模板？',
      content: `“${preset.name}”将从本机删除，无法恢复。`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      autoFocusButton: 'cancel',
      onOk: () => removePreset(preset.id),
    })
  }

  async function removePreset(id: string) {
    try {
      await deletePreset(id)
      setPresets(current => current.filter(item => item.id !== id))
      setSelectedPresetId(current => current === id ? null : current)
      message.success('模板已删除')
    } catch (error) { message.error(errorMessage(error)) }
  }

  return (
    <div className="toolbox-watermark toolbox-sticky-preview">
      <ToolboxImageCard
        items={items.map(item => ({ id: item.id, name: item.file.name, url: item.sourceUrl, status: item.status, error: item.error }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={selectImage}
        onRemove={removeFile}
        onClear={requestClearFiles}
      />
      <div className="toolbox-watermark-main">
        <section className={`toolbox-preview-panel${selected ? ' has-image' : ''}`} aria-label="水印预览">
          <div className="toolbox-section-heading">
            <div className="toolbox-preview-title">
              <strong>水印预览</strong>
              <span className="toolbox-preview-meta">
                {resultView === 'grid'
                  ? `结果网格 · ${batchSummary}`
                  : selected
                    ? `${selected.file.name} · ${selected.width} × ${selected.height}${previewMetaText ? ` · ${previewMetaText}` : ''}`
                    : '等待图片'}
              </span>
            </div>
            <div className="toolbox-preview-actions" onPointerDownCapture={rememberPreviewScroll} onFocusCapture={restorePreviewScroll}>
              {currentPreview?.loading && <span role="status" aria-live="polite">正在更新预览…</span>}
              {selected && (
                <>
                  <Segmented
                    size="small"
                    aria-label="结果视图"
                    value={resultView}
                    options={[{ label: '单张', value: 'single' }, { label: '结果网格', value: 'grid' }]}
                    onChange={value => setResultView(value === 'grid' ? 'grid' : 'single')}
                  />
                  {hasResult && resultView === 'single' && (
                    <Segmented
                      size="small"
                      aria-label="预览对照"
                      value={previewMode}
                      options={[{ label: '结果', value: 'result' }, { label: '对比原图', value: 'source' }]}
                      onChange={value => setPreviewMode(value === 'source' ? 'source' : 'result')}
                    />
                  )}
                  <PreviewResultActions
                    status={selected.status}
                    hasOutput={Boolean(selected.output)}
                    busy={busy}
                    onDownload={() => downloadOne(selected.id)}
                    onRetry={() => { void processImages([selected.id]) }}
                  />
                </>
              )}
            </div>
          </div>
          {resultView === 'grid' ? (
            <ResultGrid
              items={items.map(item => ({ id: item.id, name: item.file.name, sourceUrl: item.sourceUrl, status: item.status }))}
              results={galleryById}
              selectedId={selectedId}
              filter={resultFilter}
              onFilterChange={setResultFilter}
              onSelect={selectImage}
              ariaLabel="水印结果网格"
              compact
            />
          ) : (
            <div className="toolbox-preview-stage">
              {selected ? (
                canOpenResult ? (
                  <button
                    type="button"
                    className="toolbox-preview-open"
                    aria-label={`查看 ${selected.file.name} 的水印结果大图`}
                    onClick={() => openAt(selected.id)}
                  >
                    <img src={previewSrc ?? selected.sourceUrl} alt={previewAltText} />
                  </button>
                ) : (
                  <img src={previewSrc ?? selected.sourceUrl} alt={previewAltText} />
                )
              ) : <p>先添加图片，再设置水印</p>}
            </div>
          )}
          {currentPreview?.error && <div className="toolbox-preview-error">预览失败：{currentPreview.error}</div>}
          <PreviewItemNotice error={selected?.error} />
          <p className="toolbox-hint">
            {resultView === 'grid' ? '点击任意结果查看单张大图。' : ''}
            预览使用缩略尺寸；导出按原图像素处理。图片不会上传到服务器。
          </p>
        </section>

        <WatermarkSettingsPanel settings={settings} disabled={controlsLocked} onChange={updateSettings} onLogo={chooseLogo}
          templates={
          <div className="toolbox-presets">
            <label className="toolbox-field-label" id="watermark-template-label" htmlFor="watermark-template-select">{LOCAL_TEMPLATE_LABEL}</label>
            <div className="toolbox-preset-row">
              <Select id="watermark-template-select" aria-labelledby="watermark-template-label" placeholder="选择已保存模板" value={selectedPresetId} disabled={controlsLocked} options={presets.map(preset => ({ value: preset.id, label: preset.name }))} onChange={choosePreset} allowClear onClear={() => setSelectedPresetId(null)} />
              <Button disabled={!selectedPresetId || controlsLocked} onClick={requestRemovePreset}>删除</Button>
            </div>
            <label className="toolbox-field-label" htmlFor="watermark-preset-name">新模板名称</label>
            <div className="toolbox-preset-row">
              <Input id="watermark-preset-name" value={presetName} maxLength={40} disabled={controlsLocked} placeholder="例如：右下角版权" onChange={event => setPresetName(event.target.value)} onPressEnter={() => void saveCurrentPreset()} />
              <Button icon={<SaveOutlined />} disabled={controlsLocked} onClick={() => void saveCurrentPreset()}>保存</Button>
            </div>
          </div>
          }
        />
      </div>

      <ResultGallery
        {...galleryProps}
        resultLabel="水印结果"
        downloadLabel="下载水印结果"
        downloadTooltip="下载水印结果"
        onDownload={item => downloadOne(item.id)}
      />

      <div className="toolbox-watermark-footer">
        <div className="toolbox-progress" role="status" aria-live="polite" aria-atomic="true">
          <span>{completed.length} / {items.length} 张已完成</span>
          {processing && <Progress size="small" percent={items.length ? Math.round(completed.length / items.length * 100) : 0} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
          {settingsNotice && (
            <span className="toolbox-undo-notice">
              设置已更改，已清除 {settingsNotice.count} 张已完成结果
              <Button type="link" size="small" autoInsertSpace={false} className="toolbox-undo-button" onClick={undoSettingsChange}>撤销</Button>
            </span>
          )}
        </div>
        <div className="toolbox-footer-actions">
          <Button icon={<DownloadOutlined />} disabled={!completed.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>打包下载</Button>
          {processing ? <Button danger onClick={cancelProcessing}>取消处理</Button> : (
            <Button type="primary" disabled={!items.some(item => item.status !== 'succeeded') || !hasWatermark(settings) || busy} onClick={() => void processImages()}>开始处理</Button>
          )}
        </div>
      </div>
    </div>
  )
}
