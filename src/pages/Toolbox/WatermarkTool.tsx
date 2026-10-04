import { useEffect, useRef, useState } from 'react'
import { App, Button, Input, Progress, Select } from 'antd'
import { DownloadOutlined, SaveOutlined } from '@ant-design/icons'
import { useUserStore } from '@/store/useUserStore'
import PreviewGallery from '@/components/PreviewGallery'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import WatermarkSettingsPanel from './shared/WatermarkSettingsPanel'
import ToolboxImageCard, { PreviewItemNotice, PreviewResultActions } from './ToolboxImageCard'
import { invalidateBatch, processBatch } from './watermark/batch'
import { createWatermarkZip, downloadBlob, namesForImages } from './watermark/download'
import { deletePreset, listPresets, savePreset, type WatermarkPreset } from './watermark/presets'
import { WatermarkRenderer } from './watermark/renderer'
import { type BatchImage, type WatermarkSettings } from './watermark/types'
import { datedDownloadName } from './shared/dateStamp'
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

export default function WatermarkTool() {
  const { message } = App.useApp()
  const scope = useUserStore(state => state.userId ?? 'local')
  const [items, setItems] = useState<BatchImage[]>([])
  const { openAt, galleryProps } = useBlobPreviewGallery(items)
  const itemsRef = useRef<BatchImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
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

  const selected = items.find(item => item.id === selectedId)
  const completed = items.filter(item => item.status === 'succeeded')
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.size ?? 0), 0)
  const busy = processing || adding || packaging
  const controlsLocked = processing || packaging
  const currentPreview = selected && !processing && previewState?.imageId === selected.id && previewState.settings === settings ? previewState : null

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

  function updateSettings(patch: Partial<WatermarkSettings>) {
    if (processingRef.current || packaging) return
    const next = { ...settings, ...patch }
    setSettings(next)
    usePreferencesStore.getState().remember('watermark', watermarkMemory(next))
    setSelectedPresetId(null)
    if (itemsRef.current.some(item => item.status !== 'pending')) {
      commitItems(invalidateBatch(itemsRef.current))
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
        sourceUrl: URL.createObjectURL(file), width: inspected.width, height: inspected.height,
        status: 'pending',
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
    if (item) URL.revokeObjectURL(item.sourceUrl)
    const next = itemsRef.current.filter(candidate => candidate.id !== id)
    commitItems(next)
    if (selectedId === id) setSelectedId(next[0]?.id ?? null)
  }

  function clearFiles() {
    if (processingRef.current) return
    for (const item of itemsRef.current) URL.revokeObjectURL(item.sourceUrl)
    commitItems([])
    setSelectedId(null)
    replacePreview(null)
  }

  async function processImages(onlyIds?: string[]) {
    if (processingRef.current || addingCountRef.current || !hasWatermark(settings)) return
    const targets = itemsRef.current.filter(item => (onlyIds ? onlyIds.includes(item.id) : item.status !== 'succeeded'))
    if (!targets.length) return
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

  async function removePreset() {
    if (!selectedPresetId) return
    try {
      await deletePreset(selectedPresetId)
      setPresets(current => current.filter(item => item.id !== selectedPresetId))
      setSelectedPresetId(null)
      message.success('模板已删除')
    } catch (error) { message.error(errorMessage(error)) }
  }

  return (
    <div className="toolbox-watermark">
      <ToolboxImageCard
        items={items.map(item => ({ id: item.id, name: item.file.name, url: item.sourceUrl, status: item.status, error: item.error }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={setSelectedId}
        onRemove={removeFile}
        onClear={clearFiles}
      />
      <div className="toolbox-watermark-main">
        <section className="toolbox-preview-panel" aria-label="水印预览">
          <div className="toolbox-section-heading">
            <div className="toolbox-preview-title">
              <strong>水印预览</strong>
              <span className="toolbox-preview-meta">{selected ? `${selected.file.name} · ${selected.width} × ${selected.height}` : '等待图片'}</span>
            </div>
            <div className="toolbox-preview-actions">
              {currentPreview?.loading && <span>正在更新预览…</span>}
              {selected && (
                <PreviewResultActions
                  status={selected.status}
                  hasOutput={Boolean(selected.output)}
                  busy={busy}
                  onDownload={() => downloadOne(selected.id)}
                  onRetry={() => { void processImages([selected.id]) }}
                />
              )}
            </div>
          </div>
          <div className="toolbox-preview-stage">
            {selected ? <img src={currentPreview?.url ?? selected.sourceUrl} alt={`${selected.file.name} 的水印预览`} onClick={selected.output ? () => openAt(selected.id) : undefined} style={{ cursor: selected.output ? 'zoom-in' : undefined }} /> : <p>先添加图片，再设置水印</p>}
          </div>
          {currentPreview?.error && <div className="toolbox-preview-error">预览失败：{currentPreview.error}</div>}
          <PreviewItemNotice error={selected?.error} />
          <p className="toolbox-hint">预览使用缩略尺寸；导出按原图像素处理。图片不会上传到服务器。</p>
        </section>

        <WatermarkSettingsPanel settings={settings} disabled={controlsLocked} onChange={updateSettings} onLogo={chooseLogo}
          templates={
          <div className="toolbox-presets">
            <label className="toolbox-field-label">本机模板</label>
            <div className="toolbox-preset-row">
              <Select placeholder="选择已保存模板" value={selectedPresetId} disabled={controlsLocked} options={presets.map(preset => ({ value: preset.id, label: preset.name }))} onChange={choosePreset} allowClear onClear={() => setSelectedPresetId(null)} />
              <Button disabled={!selectedPresetId || controlsLocked} onClick={() => void removePreset()}>删除</Button>
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
        <div className="toolbox-progress">
          <span>{completed.length} / {items.length} 张已完成</span>
          {processing && <Progress size="small" percent={items.length ? Math.round(completed.length / items.length * 100) : 0} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
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
