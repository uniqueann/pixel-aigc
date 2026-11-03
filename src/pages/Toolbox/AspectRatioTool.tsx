import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Input, Progress, Segmented, Select, Spin, Tooltip } from 'antd'
import { DownloadOutlined, SaveOutlined } from '@ant-design/icons'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { useCapabilities } from '@/hooks/useCapabilities'
import CapabilityStatus from '@/components/CapabilityStatus'
import { useUserStore } from '@/store/useUserStore'
import AspectRatioSettingsPanel from './shared/AspectRatioSettingsPanel'
import ToolboxImageCard, { PreviewItemNotice, PreviewResultActions } from './ToolboxImageCard'
import ResultGallery from './shared/ResultGallery'
import ResultGrid, { type ResultFilter } from './shared/ResultGrid'
import { footerMode, progressLabel } from './shared/resultProgress'
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
import { previewAlt, previewKind, previewMeta, previewOverlay, previewSource, showCheckerboard } from './aspect-ratio/resultView'
import { aspectRatioPrivacyNote, aspectRatioProcessingHint } from './aspect-ratio/privacyCopy'
import { clearAspectRatioSession, loadAspectRatioSession, saveAspectRatioSession } from './aspect-ratio/session'
import { PREVIEW_MAX_DIMENSION, type AspectRatioSettings, type BatchImage } from './aspect-ratio/types'
import { datedDownloadName } from './shared/dateStamp'
import { LOCAL_TEMPLATE_LABEL } from './shared/presetLabels'
import { inspectImage, MAX_ZIP_BYTES, queueLimitMessage } from './shared/inspect'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { aspectRatioBatchQuote } from '@/features/credits/batchQuotes'
import { creditQuoteBlocked, type CreditQuote } from '@/features/credits/quotes'
import { INSUFFICIENT_CREDITS_REASON, imageCreditBlocksSubmit } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { isCanvasMockGateway } from '@/features/free-canvas/generation/availability'
import TaskRecoveryPanel from '@/features/task-center/TaskRecoveryPanel'
import { assertRecoveryActor,persistRecoveredResult } from '@/features/task-center/recoveryMedia'
import type { RecoveryActionContext } from '@/features/task-center/TaskRecoveryPanel'


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

type ResultView = 'single' | 'grid'
type PreviewMode = 'result' | 'source'

interface SettingsSnapshot {
  items: BatchImage[]
  settings: AspectRatioSettings
  selectedPresetId: string | null
}

export default function AspectRatioTool() {
  const { message, modal } = App.useApp()
  const navigate = useNavigate()
  const scope = useUserStore(state => state.userId ?? 'local')
  const knownBalance = useKnownCreditBalance()
  const [restoredSession] = useState(() => loadAspectRatioSession(scope))
  const [items, setItems] = useState<BatchImage[]>(() => restoredSession?.items ?? [])
  const { openAt, galleryProps } = useBlobPreviewGallery(items)
  const itemsRef = useRef<BatchImage[]>(items)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (!restoredSession) return null
    return restoredSession.selectedId && restoredSession.items.some(item => item.id === restoredSession.selectedId)
      ? restoredSession.selectedId
      : restoredSession.items[0]?.id ?? null
  })
  const [resultView, setResultView] = useState<ResultView>('single')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [previewMode, setPreviewMode] = useState<PreviewMode>('result')
  const memoryEpoch = usePreferencesStore(state => state.memoryEpoch)
  const [settings, setSettings] = useState<AspectRatioSettings>(() => restoredSession?.settings
    ?? initialAspectRatioSettings(usePreferencesStore.getState().preferences))
  const [appliedMemoryEpoch, setAppliedMemoryEpoch] = useState(memoryEpoch)
  const settingsRef = useRef(settings)
  const [settingsNotice, setSettingsNotice] = useState<{ count: number } | null>(null)
  const settingsSnapshotRef = useRef<SettingsSnapshot | null>(null)
  if (appliedMemoryEpoch !== memoryEpoch) {
    const next = initialAspectRatioSettings(usePreferencesStore.getState().preferences)
    setSettings(next)
    setAppliedMemoryEpoch(memoryEpoch)
  }
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const previewPanelRef = useRef<HTMLElement | null>(null)
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
  const galleryById = new Map(galleryProps.items.map(item => [item.id, item]))
  const batchSummary = items.length > 0
    ? `成功 ${completed.length} · 失败 ${failed.length} · 可下载 ${completed.length}`
    : '等待图片'
  const degradeLabel = unavailableCropSummary(completed.map(item => item.cropFocus))
  const missedSubjectCount = completed.filter(item => item.cropFocus?.source === 'grid' && !item.cropFocus.unavailable).length
  const processingItems = items.filter(item => item.status === 'processing')
  const donePercent = items.length ? Math.round(completed.length / items.length * 100) : 0
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
  const busy = processing || adding || packaging
  const controlsLocked = processing || packaging
  const allDone = items.length > 0 && completed.length === items.length
  const hasPending = items.some(item => item.status === 'pending')
  const mode = footerMode({ processing, itemCount: items.length, allDone, failedCount: failed.length })
  const progressDetail = processing && settings.strategy === 'crop'
    ? cropProgressLabel(completed.length, items.length, processingItems.map(item => item.file.name))
    : processing && settings.strategy === 'outpaint'
      ? outpaintProgressLabel(completed.length, items.length, processingItems.map(item => item.file.name))
      : progressLabel({ itemCount: items.length, completedCount: completed.length, failedCount: failed.length, processing })
  const statusText = progressDetail
    + (failed.length > 0 && processing && !progressDetail.includes('失败') ? `，${failed.length} 张失败` : '')
    + (degradeLabel ? ` · ${degradeLabel}` : '')
  const downloadActionLabel = completed.length > 0 && failed.length > 0
    ? `下载 ${completed.length} 张结果`
    : '打包下载'
  const kind = selected ? previewKind({ mode: previewMode, hasResult: Boolean(selected.output), status: selected.status }) : null
  const currentPreview = selected && !processing && previewState?.imageId === selected.id && previewState.settings === settings ? previewState : null
  const previewUrl = selected ? previewSource(kind ?? 'pending', currentPreview?.url ?? null, selected.sourceUrl) : undefined
  const previewAltText = selected ? previewAlt(kind ?? 'pending', selected.file.name) : ''
  const checkerboardVisible = kind ? showCheckerboard(kind, settings.strategy, settings.background) : false
  const canOpenResult = kind === 'result' && Boolean(selected?.output)
  const overlay = kind ? previewOverlay(kind) : null
  const upscale = selected ? fitScale(settings.strategy === 'crop' ? 'crop' : 'letterbox', selected.width, selected.height, preset.width, preset.height) : 1
  const quoteFor = (ids?: string[]) => aspectRatioBatchQuote(items, settings, preset.width, preset.height, { ids, mock: isCanvasMockGateway() })
  const generateQuote = quoteFor()
  const creditBlocked = imageCreditBlocksSubmit({ mock: isCanvasMockGateway(), quote: generateQuote, balance: knownBalance })
  const needsRemote = (quote: CreditQuote) => settings.strategy === 'outpaint' && (quote.status !== 'ready' || quote.credits > 0)

  function commitItems(next: BatchImage[]) {
    if (!mountedRef.current) return
    itemsRef.current = next
    setItems(next)
  }

  function replacePreview(next: string | null) {
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    previewUrlRef.current = next
  }

  function selectImage(id: string) {
    setSelectedId(id)
    setResultView('single')
    setPreviewMode('result')
  }

  function showResult() {
    if (resultView === 'grid') setResultView('single')
    previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
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
      // 源图与结果由内存会话保留；只在清空/移除时释放，避免页签切换后 URL 失效。
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current)
    }
  }, [])

  // 页签切换会卸载页面，用内存会话保留本次打开期间的队列、设置与结果。
  useEffect(() => {
    saveAspectRatioSession({ ownerId: scope, items, settings, selectedId })
  }, [scope, items, settings, selectedId])

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

  function clearSettingsNotice() {
    setSettingsNotice(null)
    settingsSnapshotRef.current = null
  }

  function updateSettings(patch: Partial<AspectRatioSettings>) {
    if (processingRef.current || packaging) return
    const next = { ...settingsRef.current, ...patch }
    const completedCount = itemsRef.current.filter(item => item.status === 'succeeded').length
    if (completedCount > 0 && !settingsNotice) {
      settingsSnapshotRef.current = { items: itemsRef.current, settings, selectedPresetId: selectedTemplateId }
      setSettingsNotice({ count: completedCount })
    }
    settingsRef.current = next
    setSettings(next)
    usePreferencesStore.getState().remember('aspect-ratio', aspectRatioMemory(next))
    setSelectedTemplateId(null)
    setPreviewMode('result')
    if (itemsRef.current.some(item => item.status !== 'pending')) commitItems(invalidateBatch(itemsRef.current))
  }

  function undoSettingsChange() {
    const snapshot = settingsSnapshotRef.current
    if (!snapshot) return
    commitItems(snapshot.items)
    settingsRef.current = snapshot.settings
    setSettings(snapshot.settings)
    usePreferencesStore.getState().remember('aspect-ratio', aspectRatioMemory(snapshot.settings))
    setSelectedTemplateId(snapshot.selectedPresetId)
    setPreviewMode('result')
    clearSettingsNotice()
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
    updateSettings(preset.settings)
    setSelectedTemplateId(id)
  }

  function requestRemovePreset() {
    const preset = presets.find(item => item.id === selectedTemplateId)
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
      setSelectedTemplateId(current => current === id ? null : current)
      message.success('模板已删除')
    } catch (error) { message.error(errorMessage(error)) }
  }

  function addFile(file: File,recovery?:RecoveryActionContext) {
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
      if(recovery)assertRecoveryActor(recovery.actor,recovery.signal)
      const item: BatchImage = {
        id: crypto.randomUUID(), file, sourceMime: inspected.mimeType,
        sourceUrl: URL.createObjectURL(file), width: inspected.width, height: inspected.height, status: 'pending',
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
    return addChainRef.current
  }

  function removeFile(id: string) {
    if (processingRef.current) return
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (item) { detectionCacheRef.current.remove(item.file); URL.revokeObjectURL(item.sourceUrl) }
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

  function clearFiles() {
    if (processingRef.current) return
    detectionCacheRef.current.clear()
    for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
    clearSettingsNotice()
    clearAspectRatioSession()
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
    if (processingRef.current || addingCountRef.current) return
    const targets = itemsRef.current.filter(item => (onlyIds ? onlyIds.includes(item.id) : item.status !== 'succeeded'))
    if (!targets.length) return
    clearSettingsNotice()
    const quote = quoteFor(onlyIds)
    if (creditQuoteBlocked(quote)) {
      message.warning('无法计算本次费用，请检查扩图范围')
      return
    }
    if (needsRemote(quote) && !outpaintReady) {
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
        // 批次结束后优先把主预览切到第一张失败项，避免用户只看到成功结果而漏掉失败。
        const firstFailed = itemsRef.current.find(item => item.status === 'failed')
        if (firstFailed) {
          setSelectedId(currentId => {
            const currentItem = itemsRef.current.find(item => item.id === currentId)
            return currentItem?.status === 'failed' ? currentId : firstFailed.id
          })
          setPreviewMode('result')
        }
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
    <div className="toolbox-watermark toolbox-aspect-ratio toolbox-sticky-preview">
      <h1 className="sr-only">转比例</h1>
      <TaskRecoveryPanel tools={['aspect-ratio']} blockedReason={processing||adding||packaging?'当前队列正在处理，请完成后再添加输入':undefined} onUseImage={async(result,image,detail,context)=>{
        await persistRecoveredResult(detail,result,context.actor,context.signal,image.blob)
        assertRecoveryActor(context.actor,context.signal)
        await addFile(new File([image.blob],`已有扩展-${detail.task.sourceId}.jpg`,{type:image.mimeType}),context)
      }}/>
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
        onSelect={selectImage}
        onRemove={removeFile}
        onClear={requestClearFiles}
        processingHint={aspectRatioProcessingHint(settings.strategy)}
      />
      <div className="toolbox-watermark-main">
        <section ref={previewPanelRef} className={`toolbox-preview-panel${selected && resultView === 'single' ? ' has-image' : ''}`} aria-label="转比例预览">
          <div className="toolbox-section-heading">
            <div className="toolbox-preview-title">
              <strong>转比例预览</strong>
              <span className="toolbox-preview-meta">{resultView === 'grid'
                ? `结果网格 · ${batchSummary}`
                : selected
                  ? `${selected.file.name} · ${selected.width} × ${selected.height}${kind && kind !== 'result' ? ` · ${previewMeta(kind)}` : ''}`
                  : `${preset.label} · ${settings.strategy === 'outpaint' && settings.outpaintOutputMode === 'original' ? '保留原图分辨率' : `${selectedOutputSize.width} × ${selectedOutputSize.height}`}`}</span>
            </div>
            <div className="toolbox-preview-actions">
              {items.length > 0 && (
                <Segmented
                  size="small"
                  aria-label="结果视图"
                  value={resultView}
                  options={[{ label: '单张', value: 'single' }, { label: '结果网格', value: 'grid' }]}
                  onChange={value => setResultView(value === 'grid' ? 'grid' : 'single')}
                />
              )}
              {selected?.output && resultView === 'single' && (
                <Segmented
                  size="small"
                  aria-label="预览对照"
                  value={previewMode}
                  options={[{ label: '结果', value: 'result' }, { label: '对比原图', value: 'source' }]}
                  onChange={value => setPreviewMode(value === 'source' ? 'source' : 'result')}
                />
              )}
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
                  retryQuote={quoteFor([selected.id])}
                  onDownload={() => { void downloadOne(selected.id) }}
                  onRetry={() => { void processImages([selected.id]) }}
                />
              )}
            </div>
          </div>
          {items.length > 0 && resultView === 'single' && <p className="toolbox-batch-summary">{batchSummary}</p>}
          {currentPreview?.error && <div className="toolbox-preview-error">预览失败：{currentPreview.error}</div>}
          <PreviewItemNotice
            error={selected?.error}
            note={selected ? (selected.status === 'processing' && settings.strategy === 'crop' ? '正在识别商品主体…' : selected.cropFocus?.note) : undefined}
            warning={Boolean(selected && selected.status !== 'processing' && selected.cropFocus?.source === 'grid')}
          />
          {resultView === 'grid' ? (
            <ResultGrid
              items={items.map(item => ({ id: item.id, name: item.file.name, sourceUrl: item.sourceUrl, status: item.status }))}
              results={galleryById}
              selectedId={selectedId}
              filter={resultFilter}
              onFilterChange={setResultFilter}
              onSelect={selectImage}
              ariaLabel="转比例结果网格"
              checkerboard={settings.strategy === 'letterbox' && settings.background === 'transparent'}
              compact={items.length <= 4}
            />
          ) : (
            <div className={`toolbox-preview-stage${checkerboardVisible ? ' is-transparent' : ''}`}>
              {selected ? (
                <>
                  {/* 处理中/失败时强制显示源图，避免旧预览被当成可交付结果。 */}
                  <img
                    src={previewUrl}
                    alt={previewAltText}
                    tabIndex={canOpenResult ? 0 : undefined}
                    role={canOpenResult ? 'button' : undefined}
                    aria-label={canOpenResult ? '打开转比例结果大图' : undefined}
                    onClick={canOpenResult ? () => openAt(selected.id) : undefined}
                    onKeyDown={canOpenResult ? event => {
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      openAt(selected.id)
                    } : undefined}
                    style={{ cursor: canOpenResult ? 'zoom-in' : undefined }}
                  />
                  {overlay && (
                    <div className={`toolbox-preview-state is-${kind}`} role={kind === 'processing' ? 'status' : undefined}>
                      {kind === 'processing' && <Spin size="small" />}
                      <span>{overlay}</span>
                    </div>
                  )}
                </>
              ) : <p>先添加图片，再选择平台和适配方式</p>}
            </div>
          )}
          <p className="toolbox-hint">
            {resultView === 'grid' ? '点击任意结果查看单张大图。' : ''}
            预览最长边不超过 {PREVIEW_MAX_DIMENSION}px；{settings.strategy === 'outpaint' && settings.outpaintOutputMode === 'original' && !selected
              ? '添加图片后显示每张图片的预计输出尺寸。'
              : `${selected ? '当前图片' : ''}导出为 ${selectedOutputSize.width} × ${selectedOutputSize.height}。`}
            {aspectRatioPrivacyNote(settings.strategy)}
          </p>
          {upscale > 2 && <p className="toolbox-hint toolbox-warning">当前图片需要放大超过 2 倍才能铺满目标尺寸，细节可能变糊。</p>}
        </section>

        <AspectRatioSettingsPanel settings={settings} disabled={controlsLocked} onChange={updateSettings}
          outpaintStatus={<CapabilityStatus ready={outpaintReady} error={capabilityError}
            unavailableMessage="智能扩展还不能用。请在服务端配置阿里云百炼的 DASHSCOPE_API_KEY（华北2北京）。"
            onRetry={() => void refetchCapabilities()} />}
          templates={
          <div className="toolbox-presets">
            <label className="toolbox-field-label">{LOCAL_TEMPLATE_LABEL}</label>
            <div className="toolbox-preset-row">
              <Select
                placeholder="选择已保存模板"
                aria-label="选择已保存模板"
                value={selectedTemplateId}
                disabled={controlsLocked}
                options={presets.map(preset => ({ value: preset.id, label: preset.name }))}
                onChange={choosePreset}
                allowClear
                onClear={() => setSelectedTemplateId(null)}
              />
              <Button disabled={!selectedTemplateId || controlsLocked} onClick={requestRemovePreset}>删除</Button>
            </div>
            <div className="toolbox-preset-row">
              <Input value={presetName} maxLength={40} disabled={controlsLocked} placeholder="新模板名称" aria-label="新模板名称" onChange={event => setPresetName(event.target.value)} onPressEnter={() => void saveCurrentPreset()} />
              <Button icon={<SaveOutlined />} disabled={controlsLocked} onClick={() => void saveCurrentPreset()}>保存</Button>
            </div>
          </div>
          }
        />
      </div>

      <ResultGallery
        {...galleryProps}
        downloadLabel="下载转比例结果"
        downloadTooltip="下载转比例结果"
        resultLabel="转比例结果"
        checkerboard={settings.strategy === 'letterbox' && settings.background === 'transparent'}
        onDownload={item => downloadOne(item.id)}
      />

      <div className="toolbox-watermark-footer">
        {settings.strategy === 'crop' && missedSubjectCount > 0 && <p className="toolbox-crop-notice toolbox-crop-warning" role="status">{missedSubjectCount} 张没识别到商品，已按当前九宫格裁剪。请把焦点改到商品所在位置后再处理。</p>}
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
          <CreditQuoteNotice quote={generateQuote} />
          <Button type={mode === 'download' ? 'primary' : 'default'} icon={<DownloadOutlined />} disabled={!completed.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>{downloadActionLabel}</Button>
          {mode === 'download' && <Button type="link" className="toolbox-view-result" onClick={showResult}>查看结果</Button>}
          {mode === 'retry' && (
            <>
              <CreditActionButton type="primary" quote={quoteFor(failed.map(item => item.id))} disabled={busy || creditBlocked || (needsRemote(quoteFor(failed.map(item => item.id))) && !outpaintReady)} onClick={() => void processImages(failed.map(item => item.id))}>重试失败项</CreditActionButton>
              {hasPending && <CreditActionButton quote={generateQuote} disabled={creditBlocked || (needsRemote(generateQuote) && !outpaintReady) || busy} onClick={() => void processImages()}>继续处理剩余</CreditActionButton>}
            </>
          )}
          {mode === 'cancel' && <Button danger onClick={cancelProcessing}>取消处理</Button>}
          {(mode === 'process' || mode === 'empty') && (
            <Tooltip title={creditBlocked ? INSUFFICIENT_CREDITS_REASON : mode === 'empty' ? '请先添加图片' : needsRemote(generateQuote) && !outpaintReady ? '智能扩展服务暂不可用' : undefined}>
              <span>
                <CreditActionButton quote={generateQuote} type="primary" disabled={creditBlocked || (needsRemote(generateQuote) && !outpaintReady) || !items.some(item => item.status !== 'succeeded') || busy} onClick={() => void processImages()}>开始处理</CreditActionButton>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
      <CreditBalanceNotice quote={generateQuote} /><CreditSettlementHint quote={generateQuote} />
    </div>
  )
}
