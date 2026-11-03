import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, Progress, Radio, Segmented, Spin, Tooltip } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useCapabilities } from '@/hooks/useCapabilities'
import CapabilityStatus from '@/components/CapabilityStatus'
import { useUserStore } from '@/store/useUserStore'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import ColorDialog from './shared/ColorDialog'
import ResultGallery from './shared/ResultGallery'
import ResultGrid, { type ResultFilter } from './shared/ResultGrid'
import ToolboxImageCard, { PreviewItemNotice, PreviewResultActions } from './ToolboxImageCard'
import { imagesNeedingRemoval, processRemovalBatch, recompositeBatch } from './bg-remove/batch'
import { requestMatte } from './bg-remove/client'
import { compositeMatte } from './bg-remove/composite'
import { createBgRemoveZip, downloadBlob, namesForImages } from './bg-remove/download'
import { canRefineEdge } from './bg-remove/edgeRefine'
import { bgRemoveHistoryOwner, persistBgRemoveQueue, persistBgRemoveResult, restoreBgRemoveItems } from './bg-remove/history'
import { usePreferencesStore } from '@/features/preferences/store'
import { initialBgRemoveSettings } from '@/features/preferences/toolParameters'
import { applyEdgeRefineResult, loadBgRemoveSession, saveBgRemoveSession, setEdgeRefineHandoff, takeEdgeRefineResult } from './bg-remove/session'
import { PREVIEW_MAX_DIMENSION, type BatchImage, type BgRemoveSettings } from './bg-remove/types'
import { footerMode, previewAlt, previewKind, previewMeta, previewOverlay, previewSource, progressLabel, showCheckerboard, type PreviewMode } from './bg-remove/resultView'
import { datedDownloadName } from './shared/dateStamp'
import { inspectImage, MAX_ZIP_BYTES, queueLimitMessage } from './shared/inspect'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { bgRemoveBatchQuote } from '@/features/credits/batchQuotes'
import { useBillingCatalog } from '@/features/credits/useBillingCatalog'
import { creditQuoteBlocked } from '@/features/credits/quotes'
import { INSUFFICIENT_CREDITS_REASON, imageCreditBlocksSubmit } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { isCanvasMockGateway } from '@/features/free-canvas/generation/availability'
import { syncCreditPrice } from '@shared/billing'
import TaskRecoveryPanel from '@/features/task-center/TaskRecoveryPanel'
import { useTaskDraftGuard } from '@/features/task-center/useTaskDraftGuard'
import { assertRecoveryActor,persistRecoveredResult } from '@/features/task-center/recoveryMedia'
import type { RecoveryActionContext } from '@/features/task-center/TaskRecoveryPanel'

type ResultView = 'single' | 'grid'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}

function composeSucceededMattes(
  items: BatchImage[],
  background: string,
  update: (id: string, patch: Partial<BatchImage>) => void,
  onError: (error: unknown) => void,
) {
  if (!items.some(item => item.matte && !item.output && item.status === 'succeeded')) return
  void recompositeBatch(items, (_image, matte) => compositeMatte(matte, background), update).catch(onError)
}

export default function BgRemoveTool() {
  const navigate = useNavigate()
  const { message, modal } = App.useApp()
  const userId = useUserStore(state => state.userId)
  const knownBalance = useKnownCreditBalance()
  const scope = userId ?? 'local'
  const historyOwner = bgRemoveHistoryOwner(userId)
  const scopeRef = useRef(scope)
  const historyOwnerRef = useRef(historyOwner)
  const bootDoneRef = useRef(false)
  const [items, setItems] = useState<BatchImage[]>([])
  const { openAt, galleryProps } = useBlobPreviewGallery(items)
  const itemsRef = useRef<BatchImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)
  const memoryEpoch = usePreferencesStore(state => state.memoryEpoch)
  const [settings, setSettings] = useState<BgRemoveSettings>(() => initialBgRemoveSettings(usePreferencesStore.getState().preferences))
  const [appliedMemoryEpoch, setAppliedMemoryEpoch] = useState(memoryEpoch)
  const settingsRef = useRef(settings)
  // 透明模式不保存颜色值，切回纯色时用这里记住的上一次颜色。
  const lastColorRef = useRef(settings.background === 'transparent' ? '#ffffff' : settings.background)
  if (appliedMemoryEpoch !== memoryEpoch) {
    setSettings(initialBgRemoveSettings(usePreferencesStore.getState().preferences))
    setAppliedMemoryEpoch(memoryEpoch)
  }
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const previewPanelRef = useRef<HTMLElement>(null)
  const [previewMode, setPreviewMode] = useState<PreviewMode>('result')
  const [resultView, setResultView] = useState<ResultView>('single')
  const [resultFilter, setResultFilter] = useState<ResultFilter>('all')
  const [colorOpen, setColorOpen] = useState(false)
  const [recompositing, setRecompositing] = useState(false)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const cancelledRef = useRef(false)
  const batchAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const addChainRef = useRef<Promise<void>>(Promise.resolve())
  const addingCountRef = useRef(0)
  const pendingBytesRef = useRef(0)
  const { capabilities: { bgRemove: serviceReady }, error: capabilityError, refetch: refetchCapabilities } = useCapabilities()
  const mockGateway = isCanvasMockGateway()
  const billing = useBillingCatalog(!mockGateway && serviceReady === true)
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)

  const selected = items.find(item => item.id === selectedId)
  const completed = items.filter(item => item.status === 'succeeded')
  const downloadable = completed.filter(item => item.output)
  const failed = items.filter(item => item.status === 'failed')
  const outputBytes = downloadable.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
  const busy = processing || adding || packaging || recompositing
  const controlsLocked = processing || packaging || recompositing
  const allDone = items.length > 0 && completed.length === items.length
  const hasPending = items.some(item => item.status === 'pending')
  const mode = footerMode({ processing, itemCount: items.length, allDone, failedCount: failed.length })
  const statusText = progressLabel({
    itemCount: items.length,
    completedCount: completed.length,
    failedCount: failed.length,
    processing,
  })
  useTaskDraftGuard({dirty:items.some(item=>item.status==='pending'||item.status==='failed'),reason:'当前队列中有未处理或未保存的图片，离开后将清空列表，是否继续？',blocked:adding||packaging?'正在读取或打包图片，请完成后再切换':undefined})
  const quoteFor = (ids?: string[]) => bgRemoveBatchQuote(items, billing.data, { ids, mock: mockGateway, loading: billing.isPending && billing.fetchStatus === 'fetching' })
  const generateQuote = quoteFor()
  const creditBlocked = imageCreditBlocksSubmit({ mock: mockGateway, quote: generateQuote, balance: knownBalance })
  const needsRemoval = (ids?: string[]) => imagesNeedingRemoval(items, ids).some(item => !item.matte)

  useLayoutEffect(() => {
    settingsRef.current = settings
    if (settings.background !== 'transparent') lastColorRef.current = settings.background
  })

  function commitItems(next: BatchImage[]) {
    if (!mountedRef.current) return
    itemsRef.current = next
    setItems(next)
  }

  function replacePreview(next: string | null) {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    previewRef.current = next
    setPreviewUrl(next)
  }

  function persistQueue() {
    void persistBgRemoveQueue(scopeRef.current, itemsRef.current, selectedIdRef.current).catch(() => undefined)
  }

  function persistItem(item: BatchImage) {
    void persistBgRemoveResult({
      ownerId: historyOwnerRef.current,
      prefsScope: scopeRef.current,
      items: itemsRef.current,
      selectedId: selectedIdRef.current,
      item,
    }).catch(() => undefined)
  }

  useEffect(() => {
    mountedRef.current = true
    scopeRef.current = scope
    historyOwnerRef.current = historyOwner
    bootDoneRef.current = false
    let active = true

    async function boot() {
      const saved = loadBgRemoveSession(scope)
      if (saved && saved.items.length > 0) {
        itemsRef.current = saved.items
        settingsRef.current = saved.settings
        selectedIdRef.current = saved.selectedId
        if (!active) return
        setItems(saved.items)
        setSettings(saved.settings)
        setSelectedId(saved.selectedId)
        const edgeResult = takeEdgeRefineResult()
        const refined = applyEdgeRefineResult(itemsRef.current, edgeResult)
        if (refined !== itemsRef.current) {
          itemsRef.current = refined
          if (active) setItems(refined)
          try {
            await recompositeBatch(
              refined,
              (_image, matte) => compositeMatte(matte, settingsRef.current.background),
              (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
            )
            const item = itemsRef.current.find(candidate => candidate.id === edgeResult?.itemId)
            if (item) persistItem(item)
          } catch (error) {
            if (mountedRef.current) message.error(errorMessage(error))
          }
        }
        bootDoneRef.current = true
        return
      }

      itemsRef.current = []
      selectedIdRef.current = null
      settingsRef.current = initialBgRemoveSettings(usePreferencesStore.getState().preferences)
      if (active) { setItems([]); setSelectedId(null); setSettings(settingsRef.current) }
      try {
        const restored = await restoreBgRemoveItems(scope, historyOwner)
        if (!active) {
          for (const item of restored.items) URL.revokeObjectURL(item.sourceUrl)
          return
        }
        itemsRef.current = restored.items
        selectedIdRef.current = restored.selectedId
        setItems(restored.items)
        setSelectedId(restored.selectedId)
        composeSucceededMattes(
          itemsRef.current,
          settingsRef.current.background,
          (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
          error => { if (mountedRef.current) message.error(errorMessage(error)) },
        )
      } catch (error) {
        if (active) message.warning(`恢复上次抠图结果失败：${errorMessage(error)}`)
      }
      bootDoneRef.current = true
    }

    void boot()
    return () => {
      active = false
      mountedRef.current = false
      cancelledRef.current = true
      batchAbortRef.current?.abort()
      if (bootDoneRef.current) {
        saveBgRemoveSession({ ownerId: scope, items: itemsRef.current, settings: settingsRef.current, selectedId: selectedIdRef.current })
        void persistBgRemoveQueue(scope, itemsRef.current, selectedIdRef.current).catch(() => undefined)
      }
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [historyOwner, message, scope])

  useEffect(() => {
    let cancelled = false
    if (!selected?.matte || processing) {
      if (!selected?.matte) queueMicrotask(() => { if (!cancelled) replacePreview(null) })
      return () => { cancelled = true }
    }
    const timer = window.setTimeout(() => {
      void compositeMatte(selected.matte!, settings.background, PREVIEW_MAX_DIMENSION).then(result => {
        const url = URL.createObjectURL(result.blob)
        if (cancelled || !mountedRef.current) URL.revokeObjectURL(url)
        else replacePreview(url)
      }).catch(error => {
        if (!cancelled && mountedRef.current) message.error(errorMessage(error))
      })
    }, 180)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [selected, settings.background, processing, message])

  async function updateBackground(background: string) {
    if (processingRef.current || packaging) return
    if (background !== 'transparent') lastColorRef.current = background
    const next = { background }
    settingsRef.current = next
    setSettings(next)
    usePreferencesStore.getState().remember('bg-remove', { background: next.background })
    const ready = itemsRef.current.filter(item => item.matte)
    if (!ready.length) return
    setRecompositing(true)
    try {
      await recompositeBatch(
        itemsRef.current,
        (_image, matte) => compositeMatte(matte, background),
        (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
      )
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      if (mountedRef.current) setRecompositing(false)
    }
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
      if (scopeRef.current !== scope) return
      const inspected = await inspectImage(file)
      if (!mountedRef.current || scopeRef.current !== scope) return
      if(recovery)assertRecoveryActor(recovery.actor,recovery.signal)
      const item: BatchImage = {
        id: crypto.randomUUID(), file, sourceMime: inspected.mimeType,
        sourceUrl: URL.createObjectURL(file), width: inspected.width, height: inspected.height, status: 'pending',
      }
      commitItems([...itemsRef.current, item])
      if (!selectedIdRef.current) {
        selectedIdRef.current = item.id
        setSelectedId(item.id)
        setPreviewMode('result')
      }
    }).catch(error => {
      if (mountedRef.current && scopeRef.current === scope) message.error(`${file.name}：${errorMessage(error)}`)
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
    if (item) URL.revokeObjectURL(item.sourceUrl)
    const next = itemsRef.current.filter(candidate => candidate.id !== id)
    commitItems(next)
    if (selectedIdRef.current === id) {
      selectedIdRef.current = next[0]?.id ?? null
      setSelectedId(selectedIdRef.current)
      setPreviewMode('result')
    }
    persistQueue()
  }

  function clearFiles() {
    if (processingRef.current) return
    modal.confirm({
      title: '清空所有图片？',
      content: '当前队列、抠图结果和未保存的修改都会被清空，且无法撤销。',
      okText: '清空',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => {
        for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
        commitItems([])
        selectedIdRef.current = null
        setSelectedId(null)
        setPreviewMode('result')
        setResultView('single')
        setResultFilter('all')
        setColorOpen(false)
        replacePreview(null)
        persistQueue()
      },
    })
  }

  function selectImage(id: string) {
    selectedIdRef.current = id
    setSelectedId(id)
    setPreviewMode('result')
    setResultView('single')
  }

  function refineEdge(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item?.matte || !canRefineEdge(item)) return
    setEdgeRefineHandoff({ itemId: item.id, file: item.file, matte: item.matte, width: item.width, height: item.height })
    navigate('/image-workstation/remove')
  }

  async function processImages(onlyIds?: string[]) {
    if (creditQuoteBlocked(quoteFor(onlyIds))) {
      message.warning('报价暂不可用，请重新加载')
      return
    }
    if (needsRemoval(onlyIds) && !serviceReady) {
      message.warning(serviceReady === false ? '智能抠图服务正在升级维护中，暂时不可用。'
        : capabilityError ? '功能配置加载失败，请重试' : '正在加载功能配置，请稍候')
      return
    }
    if (processingRef.current || addingCountRef.current) return
    setColorOpen(false)
    processingRef.current = true
    cancelledRef.current = false
    const abort = new AbortController()
    batchAbortRef.current = abort
    setProcessing(true)
    try {
      await processRemovalBatch({
        images: itemsRef.current,
        ids: onlyIds,
        remove: image => requestMatte(image, () => cancelledRef.current || !mountedRef.current, {
          signal: abort.signal, ownerId: scope,
          onTransfer: transfer => commitItems(itemsRef.current.map(item => item.id === image.id ? { ...item, transfer } : item)),
        }),
        compose: (_image, matte) => compositeMatte(matte, settingsRef.current.background),
        update: (id, patch) => {
          const next = itemsRef.current.map(item => {
            if (item.id !== id) return item
            const merged = { ...item, ...patch }
            if (patch.status === 'succeeded' && !merged.createdAt) merged.createdAt = new Date().toISOString()
            return merged
          })
          commitItems(next)
          const item = next.find(candidate => candidate.id === id)
          if (item?.status === 'succeeded' && item.matte) persistItem(item)
        },
        shouldStop: () => abort.signal.aborted || cancelledRef.current || !mountedRef.current,
      })
    } finally {
      processingRef.current = false
      if (batchAbortRef.current === abort) batchAbortRef.current = null
      if (mountedRef.current) {
        commitItems(itemsRef.current.map(item => item.status === 'processing' ? { ...item, status: 'pending' } : item))
        // 批次结束后如果当前选中的是失败/待处理项，自动把主预览切到第一张成功结果。
        const current = itemsRef.current.find(item => item.id === selectedIdRef.current)
        if (current?.status !== 'succeeded') {
          const firstSuccess = itemsRef.current.find(item => item.status === 'succeeded' && item.output)
          if (firstSuccess) {
            selectedIdRef.current = firstSuccess.id
            setSelectedId(firstSuccess.id)
            setPreviewMode('result')
          }
        }
        setProcessing(false)
      }
    }
  }

  function cancelProcessing() {
    cancelledRef.current = true
    batchAbortRef.current?.abort()
  }

  function downloadOne(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item?.output) return
    const names = namesForImages(itemsRef.current.filter(candidate => candidate.status === 'succeeded'))
    downloadBlob(item.output, names.get(id)!)
  }

  async function downloadAll() {
    if (packaging) return
    setColorOpen(false)
    setPackaging(true)
    try {
      const blob = await createBgRemoveZip(itemsRef.current)
      downloadBlob(blob, `${datedDownloadName('cutout')}.zip`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      if (mountedRef.current) setPackaging(false)
    }
  }

  function showResult() {
    if (resultView === 'grid') setResultView('single')
    previewPanelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const backgroundMode = settings.background === 'transparent' ? 'transparent' : 'color'
  const colorDialogOpen = colorOpen && !controlsLocked
  // matte 或 output 任一存在都说明结果已经生成；处理中/失败优先于旧结果。
  const previewHasResult = Boolean(selected?.matte || selected?.output)
  const kind = selected ? previewKind({ mode: previewMode, hasResult: previewHasResult, status: selected.status }) : null
  const canOpenResult = Boolean(selected?.output) && kind === 'result'
  const overlay = kind ? previewOverlay(kind) : null
  const downloadActionLabel = downloadable.length > 0 && failed.length > 0
    ? `下载 ${downloadable.length} 张结果`
    : '打包下载'
  const galleryById = new Map(galleryProps.items.map(item => [item.id, item]))
  const batchSummary = items.length > 0
    ? `成功 ${completed.length} · 失败 ${failed.length} · 可下载 ${downloadable.length}`
    : '等待图片'

  return (
    <div className="toolbox-watermark toolbox-sticky-preview">
      <h1 className="sr-only">智能抠图</h1>
      <TaskRecoveryPanel tools={['bg-remove']} blockedReason={busy?'当前队列正在处理，请完成后再添加输入':undefined} onUseImage={async (result,image,detail,context)=>{
        assertRecoveryActor(context.actor,context.signal)
        await persistRecoveredResult(detail,result,context.actor,context.signal,image.blob)
        assertRecoveryActor(context.actor,context.signal)
        await addFile(new File([image.blob],`已有抠图-${detail.task.sourceId}.png`,{type:image.mimeType}),context)
      }}/>
      <ToolboxImageCard
        items={items.map(item => ({ id: item.id, name: item.file.name, url: item.sourceUrl, status: item.status, error: item.error }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={selectImage}
        onRemove={removeFile}
        onClear={clearFiles}
        processingHint="智能抠图会上传图片处理"
      />
      <div className="toolbox-watermark-main">
        <section ref={previewPanelRef} className="toolbox-preview-panel" aria-label="抠图预览">
          <div className="toolbox-section-heading">
            <div className="toolbox-preview-title">
              <strong>抠图预览</strong>
              <span className="toolbox-preview-meta">
                {resultView === 'grid'
                  ? `结果网格 · ${batchSummary}`
                  : selected ? `${selected.file.name} · ${selected.width} × ${selected.height} · ${previewMeta(kind ?? 'pending', backgroundMode)}` : '等待图片'}
              </span>
            </div>
            {selected && (
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
                {selected.output && resultView === 'single' ? (
                  <Segmented
                    size="small"
                    aria-label="预览对照"
                    value={previewMode}
                    options={[{ label: '结果', value: 'result' }, { label: '对比原图', value: 'source' }]}
                    onChange={value => setPreviewMode(value === 'source' ? 'source' : 'result')}
                  />
                ) : null}
                {canRefineEdge(selected) && (
                  <Button size="small" type="link" disabled={busy} onClick={() => refineEdge(selected.id)}>修边缘</Button>
                )}
                <PreviewResultActions
                  status={selected.status}
                  hasOutput={Boolean(selected.output)}
                  busy={busy}
                  retryQuote={quoteFor([selected.id])}
                  onDownload={() => downloadOne(selected.id)}
                  onRetry={() => { void processImages([selected.id]) }}
                />
              </div>
            )}
          </div>
          {items.length > 0 && resultView === 'single' && <p className="toolbox-batch-summary">{batchSummary}</p>}
          {resultView === 'grid' ? (
            <ResultGrid
              items={items.map(item => ({ id: item.id, name: item.file.name, sourceUrl: item.sourceUrl, status: item.status }))}
              results={galleryById}
              selectedId={selectedId}
              filter={resultFilter}
              onFilterChange={setResultFilter}
              onSelect={selectImage}
              ariaLabel="抠图结果网格"
              checkerboard={backgroundMode === 'transparent'}
            />
          ) : (
            <div className={`toolbox-preview-stage${kind && showCheckerboard(kind, backgroundMode) ? ' is-transparent' : ''}`}>
              {selected ? (
                <>
                  {/* 处理中/失败时强制显示源图，避免旧结果残留在“未生成结果”的说明下面。 */}
                  <img
                    src={kind === 'processing' || kind === 'failed' || kind === 'pending' ? selected.sourceUrl : previewSource(previewMode, previewUrl, selected.sourceUrl)}
                    alt={previewAlt(kind ?? 'pending', selected.file.name)}
                    tabIndex={canOpenResult ? 0 : undefined}
                    role={canOpenResult ? 'button' : undefined}
                    aria-label={canOpenResult ? '打开抠图结果大图' : undefined}
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
              ) : <p>添加图片后，这里会显示抠图结果</p>}
            </div>
          )}
          <PreviewItemNotice error={selected?.error} />
          <p className="toolbox-hint">
            {resultView === 'grid' ? '点击任意结果查看单张大图。' : ''}
            预览图为压缩显示（最长边不超过 {PREVIEW_MAX_DIMENSION}px）。切换输出背景仅在本地合成，不消耗积分。
          </p>
        </section>
        <section className="toolbox-settings-panel" aria-label="抠图设置">
          <div className="toolbox-section-heading"><div><strong>抠图设置</strong><span>一次设置，应用到整批</span></div></div>
          <span id="bg-output-label" className="toolbox-field-label">输出背景</span>
          <div className="toolbox-output-options" role="radiogroup" aria-labelledby="bg-output-label">
            <Radio.Group
              value={backgroundMode}
              disabled={controlsLocked}
              onChange={event => void updateBackground(event.target.value === 'transparent' ? 'transparent' : lastColorRef.current)}
              options={[{ label: '透明 PNG', value: 'transparent' }, { label: '纯色', value: 'color' }]}
              optionType="button"
            />
          </div>
          {backgroundMode === 'color' && (
            <div className="toolbox-field-row">
              <span>背景颜色</span>
              <button
                type="button"
                className="toolbox-color-trigger"
                aria-label={`背景颜色，当前 ${settings.background.toUpperCase()}`}
                aria-haspopup="dialog"
                aria-expanded={colorDialogOpen}
                disabled={controlsLocked}
                onClick={() => setColorOpen(true)}
              >
                <span className="toolbox-color-swatch" style={{ background: settings.background }} aria-hidden="true" />
                <span>{settings.background.toUpperCase()}</span>
              </button>
            </div>
          )}
          <p className="toolbox-hint">透明背景导出为 PNG；纯色背景导出为 JPEG。切换背景不重复消耗积分。</p>
          <CapabilityStatus ready={serviceReady} error={capabilityError}
            unavailableMessage="智能抠图服务正在升级维护中，暂时不可用。"
            onRetry={() => void refetchCapabilities()} />
          <CreditQuoteNotice quote={generateQuote} onRetry={() => void billing.refetch()} />
          <CreditBalanceNotice quote={generateQuote} />
          {billing.data && <p className="toolbox-hint">本月还可免费抠图 {billing.data.freeBgRemoveRemaining} 张，超出后每张 {syncCreditPrice('bg-remove')} 积分。</p>}
          <CreditSettlementHint quote={generateQuote} />
        </section>
      </div>
      <ResultGallery
        {...galleryProps}
        downloadLabel="下载结果大图"
        downloadTooltip="下载抠图结果"
        checkerboard={backgroundMode === 'transparent'}
        onDownload={item => downloadOne(item.id)}
      />
      <ColorDialog
        open={colorDialogOpen}
        value={settings.background}
        onClose={() => setColorOpen(false)}
        onApply={color => void updateBackground(color)}
      />
      <div className="toolbox-watermark-footer">
        <div className="toolbox-progress" role="status" aria-live="polite">
          <span>{statusText}</span>
          {processing && <Progress size="small" aria-label="处理进度" percent={items.length ? Math.round(completed.length / items.length * 100) : 0} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
        </div>
        <div className="toolbox-footer-actions">
          <Button type={mode === 'download' ? 'primary' : 'default'} icon={<DownloadOutlined />} disabled={!downloadable.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>{downloadActionLabel}</Button>
          {mode === 'download' && <Button type="link" className="toolbox-view-result" onClick={showResult}>查看结果</Button>}
          {mode === 'retry' && (
            <>
              <CreditActionButton type="primary" quote={quoteFor(failed.map(item => item.id))} disabled={busy || creditBlocked || (needsRemoval(failed.map(item => item.id)) && !serviceReady)} onClick={() => void processImages(failed.map(item => item.id))}>重试失败项</CreditActionButton>
              {hasPending && <CreditActionButton quote={generateQuote} disabled={creditBlocked || (needsRemoval() && !serviceReady) || busy} onClick={() => void processImages()}>继续处理剩余</CreditActionButton>}
            </>
          )}
          {mode === 'cancel' && <Button danger onClick={cancelProcessing}>取消处理</Button>}
          {(mode === 'process' || mode === 'empty') && (
            <Tooltip title={creditBlocked ? INSUFFICIENT_CREDITS_REASON : mode === 'empty' ? '请先添加图片' : needsRemoval() && !serviceReady ? '智能抠图服务暂不可用' : undefined}>
              <span>
                <CreditActionButton quote={generateQuote} type="primary" disabled={creditBlocked || (needsRemoval() && !serviceReady) || !items.some(item => item.status !== 'succeeded') || busy} onClick={() => void processImages()}>开始处理</CreditActionButton>
              </span>
            </Tooltip>
          )}
        </div>
      </div>
    </div>
  )
}
