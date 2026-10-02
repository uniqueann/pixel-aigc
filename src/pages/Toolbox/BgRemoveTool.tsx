import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, ColorPicker, Progress, Radio } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { useCapabilities } from '@/hooks/useCapabilities'
import CapabilityStatus from '@/components/CapabilityStatus'
import { useUserStore } from '@/store/useUserStore'
import PreviewGallery from '@/components/PreviewGallery'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import BatchImageQueue from './BatchImageQueue'
import { processRemovalBatch, recompositeBatch } from './bg-remove/batch'
import { requestMatte } from './bg-remove/client'
import { compositeMatte } from './bg-remove/composite'
import { createBgRemoveZip, downloadBlob, namesForImages } from './bg-remove/download'
import { canRefineEdge } from './bg-remove/edgeRefine'
import { bgRemoveHistoryOwner, persistBgRemoveQueue, persistBgRemoveResult, restoreBgRemoveItems } from './bg-remove/history'
import { readPrefs, writePrefs } from './bg-remove/prefs'
import { applyEdgeRefineResult, loadBgRemoveSession, saveBgRemoveSession, setEdgeRefineHandoff, takeEdgeRefineResult } from './bg-remove/session'
import { DEFAULT_BG_REMOVE_SETTINGS, PREVIEW_MAX_DIMENSION, type BatchImage, type BgRemoveSettings } from './bg-remove/types'
import { datedDownloadName } from './shared/dateStamp'
import { inspectImage, MAX_ZIP_BYTES, queueLimitMessage } from './shared/inspect'

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
  const { message } = App.useApp()
  const userId = useUserStore(state => state.userId)
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
  const [settings, setSettings] = useState<BgRemoveSettings>(DEFAULT_BG_REMOVE_SETTINGS)
  const settingsRef = useRef(settings)
  const [prefsReady, setPrefsReady] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const previewRef = useRef<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const cancelledRef = useRef(false)
  const batchAbortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(true)
  const restoredRef = useRef(false)
  const addChainRef = useRef<Promise<void>>(Promise.resolve())
  const addingCountRef = useRef(0)
  const pendingBytesRef = useRef(0)
  const { capabilities: { bgRemove: serviceReady }, error: capabilityError, refetch: refetchCapabilities } = useCapabilities()
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)

  const selected = items.find(item => item.id === selectedId)
  const completed = items.filter(item => item.status === 'succeeded')
  const downloadable = completed.filter(item => item.output)
  const failed = items.filter(item => item.status === 'failed')
  const outputBytes = downloadable.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
  const busy = processing || adding || packaging
  const controlsLocked = processing || packaging

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
      if (saved) {
        restoredRef.current = true
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

      restoredRef.current = false
      itemsRef.current = []
      selectedIdRef.current = null
      settingsRef.current = DEFAULT_BG_REMOVE_SETTINGS
      if (active) { setItems([]); setSelectedId(null); setSettings(DEFAULT_BG_REMOVE_SETTINGS) }
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
    let active = true
    void readPrefs(scope).then(stored => {
      if (!active) return
      if (!restoredRef.current) {
        settingsRef.current = stored
        setSettings(stored)
      }
      setPrefsReady(true)
      composeSucceededMattes(
        itemsRef.current,
        settingsRef.current.background,
        (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
        error => { if (mountedRef.current) message.error(errorMessage(error)) },
      )
    }).catch(error => {
      if (active) message.warning(`读取上次选择失败：${errorMessage(error)}`)
      setPrefsReady(true)
    })
    return () => { active = false }
  }, [scope, message])

  useEffect(() => {
    if (!prefsReady) return
    const timer = window.setTimeout(() => {
      void writePrefs(scope, settingsRef.current).catch(() => undefined)
    }, 300)
    return () => window.clearTimeout(timer)
  }, [settings, prefsReady, scope])

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
    const next = { background }
    settingsRef.current = next
    setSettings(next)
    const ready = itemsRef.current.filter(item => item.matte)
    if (!ready.length) return
    try {
      await recompositeBatch(
        itemsRef.current,
        (_image, matte) => compositeMatte(matte, background),
        (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
      )
    } catch (error) {
      message.error(errorMessage(error))
    }
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
      if (scopeRef.current !== scope) return
      const inspected = await inspectImage(file)
      if (!mountedRef.current || scopeRef.current !== scope) return
      const item: BatchImage = {
        id: crypto.randomUUID(), file, sourceMime: inspected.mimeType,
        sourceUrl: URL.createObjectURL(file), width: inspected.width, height: inspected.height, status: 'pending',
      }
      commitItems([...itemsRef.current, item])
      if (!selectedIdRef.current) {
        selectedIdRef.current = item.id
        setSelectedId(item.id)
      }
    }).catch(error => {
      if (mountedRef.current && scopeRef.current === scope) message.error(`${file.name}：${errorMessage(error)}`)
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
    commitItems(next)
    if (selectedIdRef.current === id) {
      selectedIdRef.current = next[0]?.id ?? null
      setSelectedId(selectedIdRef.current)
    }
    persistQueue()
  }

  function clearFiles() {
    if (processingRef.current) return
    for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
    commitItems([])
    selectedIdRef.current = null
    setSelectedId(null)
    replacePreview(null)
    persistQueue()
  }

  function selectImage(id: string) {
    selectedIdRef.current = id
    setSelectedId(id)
  }

  function refineEdge(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item?.matte || !canRefineEdge(item)) return
    setEdgeRefineHandoff({ itemId: item.id, file: item.file, matte: item.matte, width: item.width, height: item.height })
    navigate('/image-workstation/remove')
  }

  async function processImages(onlyIds?: string[]) {
    if (!serviceReady) {
      message.warning(serviceReady === false ? '智能抠图即将上线，腾讯云商品抠图的配置还没填好'
        : capabilityError ? '功能配置加载失败，请重试' : '正在加载功能配置，请稍候')
      return
    }
    if (processingRef.current || addingCountRef.current) return
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

  const backgroundMode = settings.background === 'transparent' ? 'transparent' : 'color'

  return (
    <div className="toolbox-watermark">
      <div className="toolbox-watermark-main">
        <section className="toolbox-preview-panel" aria-label="抠图预览">
          <div className="toolbox-section-heading">
            <div><strong>抠图预览</strong><span>{selected ? `${selected.width} × ${selected.height}` : '等待图片'}</span></div>
          </div>
          <div className="toolbox-preview-stage">
            {selected ? <img src={previewUrl ?? selected.sourceUrl} alt={`${selected.file.name} 的抠图预览`} onClick={selected.output ? () => openAt(selected.id) : undefined} style={{ cursor: selected.output ? 'zoom-in' : undefined }} /> : <p>先添加图片，再选择背景</p>}
          </div>
          <p className="toolbox-hint">有抠图结果后，预览最长边不超过 {PREVIEW_MAX_DIMENSION}px。换背景只在本机重新合成。</p>
        </section>
        <section className="toolbox-settings-panel" aria-label="抠图设置">
          <div className="toolbox-section-heading"><div><strong>抠图设置</strong><span>一次设置，应用到整批</span></div></div>
          <label className="toolbox-field-label">输出背景</label>
          <Radio.Group
            value={backgroundMode}
            disabled={controlsLocked}
            onChange={event => void updateBackground(event.target.value === 'transparent' ? 'transparent' : '#ffffff')}
            options={[{ label: '纯色', value: 'color' }, { label: '透明 PNG', value: 'transparent' }]}
            optionType="button"
          />
          {backgroundMode === 'color' && (
            <div className="toolbox-field-row">
              <span>背景颜色</span>
              <ColorPicker value={settings.background} disabled={controlsLocked} onChange={color => void updateBackground(color.toHexString())} />
            </div>
          )}
          <p className="toolbox-hint">白底和纯色导出 JPEG。透明导出 PNG。已抠过的图片换颜色不会重新请求模型。</p>
          <CapabilityStatus ready={serviceReady} error={capabilityError}
            unavailableMessage="智能抠图即将上线。腾讯云商品抠图的配置还没填好，现在不能开始处理。"
            onRetry={() => void refetchCapabilities()} />
        </section>
      </div>
      <BatchImageQueue
        items={items.map(item => ({ id: item.id, name: item.file.name, url: item.sourceUrl, width: item.width, height: item.height, status: item.status, error: item.error, canRefine: canRefineEdge(item) }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={selectImage}
        onRemove={removeFile}
        onClear={clearFiles}
        onRetry={id => { void processImages([id]) }}
        onDownload={downloadOne}
        onPreviewResult={openAt}
        onRefine={refineEdge}
      />
      <PreviewGallery {...galleryProps} onDownload={item => downloadOne(item.id)} />
      <div className="toolbox-watermark-footer">
        <div className="toolbox-progress">
          <span>{completed.length} / {items.length} 张已完成</span>
          {processing && <Progress size="small" percent={items.length ? Math.round(completed.length / items.length * 100) : 0} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
        </div>
        <div className="toolbox-footer-actions">
          <Button icon={<DownloadOutlined />} disabled={!downloadable.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>打包下载</Button>
          {failed.length > 0 && !processing && <Button disabled={busy || !serviceReady} onClick={() => void processImages(failed.map(item => item.id))}>重试失败项</Button>}
          {processing ? <Button danger onClick={cancelProcessing}>取消处理</Button> : (
            <Button type="primary" disabled={!serviceReady || !items.some(item => item.status !== 'succeeded') || busy} onClick={() => void processImages()}>开始处理</Button>
          )}
        </div>
      </div>
    </div>
  )
}
