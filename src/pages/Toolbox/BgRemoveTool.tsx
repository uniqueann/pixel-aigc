import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, ColorPicker, Progress, Radio } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import BatchImageQueue from './BatchImageQueue'
import { processRemovalBatch, recompositeBatch } from './bg-remove/batch'
import { requestMatte } from './bg-remove/client'
import { compositeMatte } from './bg-remove/composite'
import { createBgRemoveZip, downloadBlob, namesForImages } from './bg-remove/download'
import { canRefineEdge } from './bg-remove/edgeRefine'
import { readPrefs, writePrefs } from './bg-remove/prefs'
import { applyEdgeRefineResult, loadBgRemoveSession, saveBgRemoveSession, setEdgeRefineHandoff, takeEdgeRefineResult } from './bg-remove/session'
import { DEFAULT_BG_REMOVE_SETTINGS, PREVIEW_MAX_DIMENSION, type BatchImage, type BgRemoveSettings } from './bg-remove/types'
import { inspectImage, MAX_ZIP_BYTES, queueLimitMessage } from './shared/inspect'

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}

export default function BgRemoveTool() {
  const navigate = useNavigate()
  const { message } = App.useApp()
  const scope = useUserStore(state => state.userId ?? 'local')
  const [items, setItems] = useState<BatchImage[]>([])
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
  const mountedRef = useRef(true)
  const restoredRef = useRef(false)
  const addChainRef = useRef<Promise<void>>(Promise.resolve())
  const addingCountRef = useRef(0)
  const pendingBytesRef = useRef(0)
  const serviceReady = liveCapabilityReady(Capability.BgRemove)
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)

  const selected = items.find(item => item.id === selectedId)
  const completed = items.filter(item => item.status === 'succeeded')
  const failed = items.filter(item => item.status === 'failed')
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
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

  useEffect(() => {
    mountedRef.current = true
    const saved = loadBgRemoveSession()
    if (saved) {
      restoredRef.current = true
      itemsRef.current = saved.items
      setItems(saved.items)
      settingsRef.current = saved.settings
      setSettings(saved.settings)
      selectedIdRef.current = saved.selectedId
      setSelectedId(saved.selectedId)
    }
    const refined = applyEdgeRefineResult(itemsRef.current, takeEdgeRefineResult())
    if (refined !== itemsRef.current) {
      itemsRef.current = refined
      setItems(refined)
      void recompositeBatch(
        refined,
        (_image, matte) => compositeMatte(matte, settingsRef.current.background),
        (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
      ).catch(error => {
        if (mountedRef.current) message.error(errorMessage(error))
      })
    }
    return () => {
      mountedRef.current = false
      cancelledRef.current = true
      saveBgRemoveSession({ items: itemsRef.current, settings: settingsRef.current, selectedId: selectedIdRef.current })
      if (previewRef.current) URL.revokeObjectURL(previewRef.current)
    }
  }, [message])

  useEffect(() => {
    let active = true
    void readPrefs(scope).then(stored => {
      if (!active) return
      if (!restoredRef.current) {
        settingsRef.current = stored
        setSettings(stored)
      }
      setPrefsReady(true)
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
      if (!selected?.matte) replacePreview(null)
      return
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
      const inspected = await inspectImage(file)
      if (!mountedRef.current) return
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
    commitItems(next)
    if (selectedIdRef.current === id) {
      selectedIdRef.current = next[0]?.id ?? null
      setSelectedId(selectedIdRef.current)
    }
  }

  function clearFiles() {
    if (processingRef.current) return
    for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
    commitItems([])
    selectedIdRef.current = null
    setSelectedId(null)
    replacePreview(null)
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
      message.warning('智能抠图即将上线，真实抠图服务还没接入')
      return
    }
    if (processingRef.current || addingCountRef.current) return
    processingRef.current = true
    cancelledRef.current = false
    setProcessing(true)
    try {
      await processRemovalBatch({
        images: itemsRef.current,
        ids: onlyIds,
        remove: image => requestMatte(image, () => cancelledRef.current || !mountedRef.current),
        compose: (_image, matte) => compositeMatte(matte, settingsRef.current.background),
        update: (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
        shouldStop: () => cancelledRef.current || !mountedRef.current,
      })
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
      downloadBlob(blob, `cutout_${new Date().toISOString().slice(0, 10)}.zip`)
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
            {selected ? <img src={previewUrl ?? selected.sourceUrl} alt={`${selected.file.name} 的抠图预览`} /> : <p>先添加图片，再选择背景</p>}
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
          {!serviceReady && <p className="toolbox-hint toolbox-warning">智能抠图即将上线。真实抠图服务还没接入，现在不能开始处理。</p>}
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
        onRefine={refineEdge}
      />
      <div className="toolbox-watermark-footer">
        <div className="toolbox-progress">
          <span>{completed.length} / {items.length} 张已完成</span>
          {processing && <Progress size="small" percent={items.length ? Math.round(completed.length / items.length * 100) : 0} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
        </div>
        <div className="toolbox-footer-actions">
          <Button icon={<DownloadOutlined />} disabled={!completed.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>打包下载</Button>
          {failed.length > 0 && !processing && <Button disabled={busy || !serviceReady} onClick={() => void processImages(failed.map(item => item.id))}>重试失败项</Button>}
          {processing ? <Button danger onClick={cancelProcessing}>取消处理</Button> : (
            <Button type="primary" disabled={!serviceReady || !items.some(item => item.status !== 'succeeded') || busy} onClick={() => void processImages()}>开始处理</Button>
          )}
        </div>
      </div>
    </div>
  )
}
