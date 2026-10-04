import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Input, Progress, Select } from 'antd'
import { DownloadOutlined, SaveOutlined } from '@ant-design/icons'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { useCapabilities } from '@/hooks/useCapabilities'
import CapabilityStatus from '@/components/CapabilityStatus'
import { useUserStore } from '@/store/useUserStore'
import AspectRatioSettingsPanel from './shared/AspectRatioSettingsPanel'
import ToolboxImageCard, { PreviewItemNotice, PreviewResultActions } from './ToolboxImageCard'
import PreviewGallery from '@/components/PreviewGallery'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import { invalidateBatch, processBatch } from './aspect-ratio/batch'
import { createAspectRatioZip, downloadBlob, namesForImages, normalizedDownloadImages } from './aspect-ratio/download'
import { fitScale } from './aspect-ratio/geometry'
import { setOutpaintHandoff } from './aspect-ratio/handoff'
import { expansionPlan, outpaintProgressLabel, processOutpaintBatch } from './aspect-ratio/expansion'
import { expandRemoteImage } from './aspect-ratio/outpaintClient'
import { usePreferencesStore } from '@/features/preferences/store'
import { initialAspectRatioSettings, aspectRatioMemory } from '@/features/preferences/toolParameters'
import { deletePreset, listPresets, savePreset, type AspectRatioPreset } from './aspect-ratio/presets'
import { AspectRatioRenderer } from './aspect-ratio/renderer'
import { SubjectDetectionCache } from './aspect-ratio/subjectCache'
import { cropProgressLabel, unavailableCropSummary } from './aspect-ratio/subjectFocus'
import { PREVIEW_MAX_DIMENSION, type AspectRatioSettings, type BatchImage } from './aspect-ratio/types'
import { datedDownloadName } from './shared/dateStamp'
import { inspectImage, MAX_ZIP_BYTES, queueLimitMessage } from './shared/inspect'


function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}

interface PreviewState {
  imageId: string
  settings: AspectRatioSettings
  loading: boolean
  url?: string
  error?: string
}

export default function AspectRatioTool() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const scope = useUserStore(state => state.userId ?? 'local')
  const [items, setItems] = useState<BatchImage[]>([])
  const { openAt, galleryProps } = useBlobPreviewGallery(items)
  const itemsRef = useRef<BatchImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const memoryEpoch = usePreferencesStore(state => state.memoryEpoch)
  const [settings, setSettings] = useState<AspectRatioSettings>(() => initialAspectRatioSettings(usePreferencesStore.getState().preferences))
  const [appliedMemoryEpoch, setAppliedMemoryEpoch] = useState(memoryEpoch)
  const settingsRef = useRef(settings)
  if (appliedMemoryEpoch !== memoryEpoch) {
    const next = initialAspectRatioSettings(usePreferencesStore.getState().preferences)
    setSettings(next)
    setAppliedMemoryEpoch(memoryEpoch)
  }
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const cancelledRef = useRef(false)
  const detectionCacheRef = useRef(new SubjectDetectionCache(scope))
  const processingAbortRef = useRef(new AbortController())
  const batchVersionRef = useRef(0)
  const mountedRef = useRef(true)
  const rendererRef = useRef<AspectRatioRenderer | null>(null)
  const addChainRef = useRef<Promise<void>>(Promise.resolve())
  const addingCountRef = useRef(0)
  const pendingBytesRef = useRef(0)
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const { capabilities: { outpaint: outpaintReady }, error: capabilityError, refetch: refetchCapabilities } = useCapabilities()
  const [presets, setPresets] = useState<AspectRatioPreset[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [presetName, setPresetName] = useState('')

  const preset = PLATFORM_SIZE_PRESETS.find(item => item.id === settings.selectedPresetId) ?? PLATFORM_SIZE_PRESETS[0]
  const selected = items.find(item => item.id === selectedId)
  const selectedOutputPlan = selected && settings.strategy === 'outpaint'
    ? expansionPlan(selected.width, selected.height, preset.width, preset.height, settings.outpaintOutputMode)
    : undefined
  const selectedOutputSize = selectedOutputPlan?.targetSize ?? { width: preset.width, height: preset.height }
  const completed = items.filter(item => item.status === 'succeeded')
  const failed = items.filter(item => item.status === 'failed')
  const degradeLabel = unavailableCropSummary(completed.map(item => item.cropFocus))
  const missedSubjectCount = completed.filter(item => item.cropFocus?.source === 'grid' && !item.cropFocus.unavailable).length
  const processingItems = items.filter(item => item.status === 'processing')
  const donePercent = items.length ? Math.round(completed.length / items.length * 100) : 0
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
  const busy = processing || adding || packaging
  const controlsLocked = processing || packaging
  const currentPreview = selected && !processing && previewState?.imageId === selected.id && previewState.settings === settings ? previewState : null
  const upscale = selected ? fitScale(settings.strategy === 'crop' ? 'crop' : 'letterbox', selected.width, selected.height, preset.width, preset.height) : 1

  function commitItems(next: BatchImage[]) {
    if (!mountedRef.current) return
    itemsRef.current = next
    setItems(next)
  }

  function replacePreview(next: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = next
  }

  useLayoutEffect(() => {
    settingsRef.current = settings
  })

  function renderer() {
    if (!rendererRef.current) rendererRef.current = new AspectRatioRenderer()
    return rendererRef.current
  }

  useEffect(() => {
    mountedRef.current = true
    const detectionCache = detectionCacheRef.current
    const batchVersion = batchVersionRef
    const unsubscribe = useUserStore.subscribe((state, previous) => {
      if (state.userId === previous.userId) return
      detectionCache.setOwner(state.userId ?? 'local')
      batchVersion.current++
      cancelledRef.current = true
      processingAbortRef.current.abort()
      rendererRef.current?.dispose()
      rendererRef.current = null
      commitItems(invalidateBatch(itemsRef.current))
    })
    return () => {
      unsubscribe()
      mountedRef.current = false
      batchVersion.current++
      processingAbortRef.current.abort()
      detectionCache.clear()
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
    let previewRenderer: AspectRatioRenderer | null = null
    if (!selected) {
      replacePreview(null)
      return
    }
    if (processing) return
    const cropFocus = settings.strategy === 'crop' ? selected.cropFocus : undefined
    const previewSettings = settings.strategy === 'outpaint'
      ? { ...settings, strategy: 'letterbox' as const, background: '#14352c' }
      : cropFocus ? { ...settings, fx: cropFocus.fx, fy: cropFocus.fy } : settings
    const timer = window.setTimeout(() => {
      setPreviewState({ imageId: selected.id, settings, loading: true })
      previewRenderer = new AspectRatioRenderer()
      void previewRenderer.render({
        file: selected.file,
        settings: previewSettings,
        targetWidth: preset.width,
        targetHeight: preset.height,
        previewMaxDimension: PREVIEW_MAX_DIMENSION,
      }).then(result => {
        const url = URL.createObjectURL(result.blob)
        if (cancelled || !mountedRef.current) URL.revokeObjectURL(url)
        else {
          replacePreview(url)
          setPreviewState({ imageId: selected.id, settings, loading: false, url })
        }
      }).catch(error => {
        if (!cancelled && mountedRef.current) setPreviewState({ imageId: selected.id, settings, loading: false, error: errorMessage(error) })
      }).finally(() => {
        previewRenderer?.dispose()
        previewRenderer = null
      })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer); previewRenderer?.dispose() }
  }, [selected, settings, processing, preset.width, preset.height])

  function updateSettings(patch: Partial<AspectRatioSettings>) {
    if (processingRef.current || packaging) return
    const next = { ...settingsRef.current, ...patch }
    settingsRef.current = next
    setSettings(next)
    usePreferencesStore.getState().remember('aspect-ratio', aspectRatioMemory(next))
    setSelectedTemplateId(null)
    if (itemsRef.current.some(item => item.status !== 'pending')) commitItems(invalidateBatch(itemsRef.current))
  }

  async function saveCurrentPreset() {
    const name = presetName.trim()
    if (!name) { message.warning('请先输入模板名称'); return }
    if (presets.some(preset => preset.name === name)) { message.warning('模板名称已存在'); return }
    try {
      const preset = await savePreset(scope, name, settingsRef.current)
      setPresets(current => [preset, ...current])
      setSelectedTemplateId(preset.id)
      setPresetName('')
      message.success('模板已保存在本机')
    } catch (error) { message.error(errorMessage(error)) }
  }

  function choosePreset(id: string) {
    const preset = presets.find(item => item.id === id)
    if (!preset || processingRef.current || packaging) return
    const next = preset.settings
    settingsRef.current = next
    setSettings(next)
    usePreferencesStore.getState().remember('aspect-ratio', aspectRatioMemory(next))
    setSelectedTemplateId(id)
    if (itemsRef.current.some(item => item.status !== 'pending')) commitItems(invalidateBatch(itemsRef.current))
  }

  async function removePreset() {
    if (!selectedTemplateId) return
    try {
      await deletePreset(selectedTemplateId)
      setPresets(current => current.filter(item => item.id !== selectedTemplateId))
      setSelectedTemplateId(null)
      message.success('模板已删除')
    } catch (error) { message.error(errorMessage(error)) }
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
        sourceUrl: URL.createObjectURL(file), width: inspected.width, height: inspected.height, status: 'pending',
      }
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
    if (item) { detectionCacheRef.current.remove(item.file); URL.revokeObjectURL(item.sourceUrl) }
    const next = itemsRef.current.filter(candidate => candidate.id !== id)
    commitItems(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }

  function clearFiles() {
    if (processingRef.current) return
    detectionCacheRef.current.clear()
    for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
    commitItems([])
    setSelectedId(null)
    replacePreview(null)
  }

  async function processImages(onlyIds?: string[]) {
    if (processingRef.current || addingCountRef.current) return
    const targets = itemsRef.current.filter(item => (onlyIds ? onlyIds.includes(item.id) : item.status !== 'succeeded'))
    if (!targets.length) return
    if (settings.strategy === 'outpaint' && !outpaintReady) {
      message.warning(outpaintReady === false ? '智能扩展还没配好阿里云百炼 API Key'
        : capabilityError ? '功能配置加载失败，请重试' : '正在加载功能配置，请稍候')
      return
    }
    processingRef.current = true
    cancelledRef.current = false
    const version = ++batchVersionRef.current
    const owner = useUserStore.getState().userId ?? 'local'
    detectionCacheRef.current.setOwner(owner)
    const abort = new AbortController()
    processingAbortRef.current = abort
    const current = () => mountedRef.current && version === batchVersionRef.current && owner === (useUserStore.getState().userId ?? 'local')
    const shouldStop = () => cancelledRef.current || abort.signal.aborted || !current()
    const update = (id: string, patch: Partial<BatchImage>) => {
      if (current()) commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item))
    }
    setProcessing(true)
    try {
      if (settings.strategy === 'outpaint') {
        await processOutpaintBatch({
          images: itemsRef.current,
          settings,
          targetWidth: preset.width,
          targetHeight: preset.height,
          ids: onlyIds,
          renderLocal: (image, plan) => settings.outpaintOutputMode === 'original'
            ? Promise.resolve({ blob: image.file, mimeType: image.file.type, width: image.width, height: image.height })
            : renderer().render({
            file: image.file,
            settings: { ...settings, strategy: 'letterbox', background: '#ffffff' },
            targetWidth: plan.targetSize.width,
            targetHeight: plan.targetSize.height,
          }),
          expandRemote: (image, plan) => expandRemoteImage(image, plan, shouldStop),
          update, shouldStop,
        })
      } else {
        await processBatch({
          images: itemsRef.current,
          settings,
          targetWidth: preset.width,
          targetHeight: preset.height,
          ids: onlyIds,
          detect: image => detectionCacheRef.current.read(image, { signal: abort.signal }),
          render: request => renderer().render(request),
          update, shouldStop,
        })
      }
    } finally {
      processingRef.current = false
      if (current()) {
        commitItems(itemsRef.current.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item))
      }
      if (mountedRef.current && processingAbortRef.current === abort) setProcessing(false)
    }
  }

  function cancelProcessing() {
    cancelledRef.current = true
    processingAbortRef.current.abort()
    rendererRef.current?.dispose()
    rendererRef.current = null
  }

  function refineFailed(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item || settingsRef.current.strategy !== 'outpaint') return
    setOutpaintHandoff({ file: item.file, presetId: preset.id, outputMode: settingsRef.current.outpaintOutputMode ?? 'platform' })
    navigate('/image-workstation/outpaint')
  }

  async function downloadOne(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item?.output) return
    try {
      const normalized = await normalizedDownloadImages(itemsRef.current.filter(candidate => candidate.status === 'succeeded'))
      const names = namesForImages(normalized, preset.id)
      downloadBlob(normalized.find(candidate => candidate.id === id)!.output!, names.get(id)!)
    } catch (error) { message.error(errorMessage(error)) }
  }

  async function downloadAll() {
    if (packaging) return
    setPackaging(true)
    try {
      const blob = await createAspectRatioZip(itemsRef.current, preset.id)
      downloadBlob(blob, `${datedDownloadName(`aspect-ratio_${preset.id}`)}.zip`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      if (mountedRef.current) setPackaging(false)
    }
  }

  return (
    <div className="toolbox-watermark">
      <ToolboxImageCard
        items={items.map(item => ({
          id: item.id,
          name: item.file.name,
          url: item.sourceUrl,
          status: item.status,
          error: item.error,
          note: item.status === 'processing' && settings.strategy === 'crop' ? '正在识别商品主体…' : item.cropFocus?.note,
        }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={setSelectedId}
        onRemove={removeFile}
        onClear={clearFiles}
        processingHint={settings.strategy === 'outpaint' ? '智能扩展会上传图片生成背景' : undefined}
      />
      <div className="toolbox-watermark-main">
        <section className="toolbox-preview-panel" aria-label="转比例预览">
          <div className="toolbox-section-heading">
            <div className="toolbox-preview-title">
              <strong>转比例预览</strong>
              <span className="toolbox-preview-meta">{selected
                ? `${selected.file.name} · ${selected.width} × ${selected.height}`
                : `${preset.label} · ${settings.strategy === 'outpaint' && settings.outpaintOutputMode === 'original' ? '保留原图分辨率' : `${selectedOutputSize.width} × ${selectedOutputSize.height}`}`}</span>
            </div>
            <div className="toolbox-preview-actions">
              {currentPreview?.loading && <span>正在更新预览…</span>}
              {settings.strategy === 'outpaint' && selected?.status === 'failed' && (
                <Button size="small" type="link" disabled={busy} onClick={() => refineFailed(selected.id)}>去工作站精修</Button>
              )}
              {selected && (
                <PreviewResultActions
                  status={selected.status}
                  hasOutput={Boolean(selected.output)}
                  retry={selected.status === 'succeeded' && Boolean(selected.cropFocus?.unavailable)}
                  busy={busy}
                  onDownload={() => { void downloadOne(selected.id) }}
                  onRetry={() => { void processImages([selected.id]) }}
                />
              )}
            </div>
          </div>
          <div className="toolbox-preview-stage">
            {selected ? <img src={currentPreview?.url ?? selected.sourceUrl} alt={`${selected.file.name} 的转比例预览`} onClick={selected.output ? () => openAt(selected.id) : undefined} style={{ cursor: selected.output ? 'zoom-in' : undefined }} /> : <p>先添加图片，再选择平台和适配方式</p>}
          </div>
          {currentPreview?.error && <div className="toolbox-preview-error">预览失败：{currentPreview.error}</div>}
          <p className="toolbox-hint">
            预览最长边不超过 {PREVIEW_MAX_DIMENSION}px；{settings.strategy === 'outpaint' && settings.outpaintOutputMode === 'original' && !selected
              ? '添加图片后显示每张图片的预计输出尺寸。'
              : `${selected ? '当前图片' : ''}导出为 ${selectedOutputSize.width} × ${selectedOutputSize.height}。`}
            {settings.strategy === 'outpaint' ? '智能扩展会上传图片生成背景。' : '图片在本机处理。'}
          </p>
          {upscale > 2 && <p className="toolbox-hint toolbox-warning">当前图片需要放大超过 2 倍才能铺满目标尺寸，细节可能变糊。</p>}
          <PreviewItemNotice
            error={selected?.error}
            note={selected ? (selected.status === 'processing' && settings.strategy === 'crop' ? '正在识别商品主体…' : selected.cropFocus?.note) : undefined}
            warning={Boolean(selected && selected.status !== 'processing' && selected.cropFocus?.source === 'grid')}
          />
        </section>

        <AspectRatioSettingsPanel settings={settings} disabled={controlsLocked} onChange={updateSettings}
          outpaintStatus={<CapabilityStatus ready={outpaintReady} error={capabilityError}
            unavailableMessage="智能扩展还不能用。请在服务端配置阿里云百炼的 DASHSCOPE_API_KEY（华北2北京）。"
            onRetry={() => void refetchCapabilities()} />}
          templates={
          <div className="toolbox-presets">
            <label className="toolbox-field-label">本机模板</label>
            <div className="toolbox-preset-row">
              <Select
                placeholder="选择已保存模板"
                value={selectedTemplateId}
                disabled={controlsLocked}
                options={presets.map(preset => ({ value: preset.id, label: preset.name }))}
                onChange={choosePreset}
                allowClear
                onClear={() => setSelectedTemplateId(null)}
              />
              <Button disabled={!selectedTemplateId || controlsLocked} onClick={() => void removePreset()}>删除</Button>
            </div>
            <div className="toolbox-preset-row">
              <Input value={presetName} maxLength={40} disabled={controlsLocked} placeholder="新模板名称" onChange={event => setPresetName(event.target.value)} onPressEnter={() => void saveCurrentPreset()} />
              <Button icon={<SaveOutlined />} disabled={controlsLocked} onClick={() => void saveCurrentPreset()}>保存</Button>
            </div>
          </div>
          }
        />
      </div>

      <PreviewGallery {...galleryProps} onDownload={item => downloadOne(item.id)} />

      <div className="toolbox-watermark-footer">
        {settings.strategy === 'crop' && degradeLabel && <p className="toolbox-crop-notice toolbox-crop-warning" role="status">{degradeLabel}</p>}
        {settings.strategy === 'crop' && missedSubjectCount > 0 && <p className="toolbox-crop-notice toolbox-crop-warning" role="status">{missedSubjectCount} 张没识别到商品，已按当前九宫格裁剪。请把焦点改到商品所在位置后再处理。</p>}
        <div className="toolbox-progress">
          <span className="toolbox-progress-status">{(processing && settings.strategy === 'crop'
            ? cropProgressLabel(completed.length, items.length, processingItems.map(item => item.file.name))
            : processing && settings.strategy === 'outpaint'
              ? outpaintProgressLabel(completed.length, items.length, processingItems.map(item => item.file.name))
              : `${completed.length} / ${items.length} 张已完成`) + (degradeLabel ? ` · ${degradeLabel}` : '')}</span>
          {processing && <Progress size="small" status="active" percent={Math.max(donePercent, 8)} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
        </div>
        <div className="toolbox-footer-actions">
          <Button icon={<DownloadOutlined />} disabled={!completed.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>打包下载</Button>
          {failed.length > 0 && !processing && <Button disabled={busy || (settings.strategy === 'outpaint' && !outpaintReady)} onClick={() => void processImages(failed.map(item => item.id))}>重试失败项</Button>}
          {processing ? <Button danger onClick={cancelProcessing}>取消处理</Button> : (
            <Button type="primary" disabled={(settings.strategy === 'outpaint' && !outpaintReady) || !items.some(item => item.status !== 'succeeded') || busy} onClick={() => void processImages()}>开始处理</Button>
          )}
        </div>
      </div>
    </div>
  )
}
