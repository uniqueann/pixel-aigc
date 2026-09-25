import { useEffect, useRef, useState } from 'react'
import { App, Button, ColorPicker, Input, Progress, Radio, Select, Slider, Upload } from 'antd'
import { DownloadOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import { useUserStore } from '@/store/useUserStore'
import BatchImageQueue from './BatchImageQueue'
import { invalidateBatch, processBatch } from './watermark/batch'
import { createWatermarkZip, downloadBlob, namesForImages } from './watermark/download'
import { deletePreset, listPresets, savePreset, type WatermarkPreset } from './watermark/presets'
import { WatermarkRenderer } from './watermark/renderer'
import { DEFAULT_WATERMARK_SETTINGS, type BatchImage, type WatermarkAnchor, type WatermarkSettings } from './watermark/types'
import { inspectImage, inspectLogo, MAX_ZIP_BYTES, queueLimitMessage } from './watermark/validation'

const anchors: { value: WatermarkAnchor; label: string }[] = [
  { value: 'top-left', label: '左上' },
  { value: 'top-center', label: '上中' },
  { value: 'top-right', label: '右上' },
  { value: 'middle-left', label: '左中' },
  { value: 'middle-center', label: '正中' },
  { value: 'middle-right', label: '右中' },
  { value: 'bottom-left', label: '左下' },
  { value: 'bottom-center', label: '下中' },
  { value: 'bottom-right', label: '右下' },
]

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败'
}

function hasWatermark(settings: WatermarkSettings) {
  return settings.kind === 'text' ? Boolean(settings.text.trim()) : Boolean(settings.logo)
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
  const itemsRef = useRef<BatchImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settings, setSettings] = useState<WatermarkSettings>(DEFAULT_WATERMARK_SETTINGS)
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
    setSettings(previous => ({ ...previous, ...patch }))
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
      downloadBlob(blob, `watermarked_${new Date().toISOString().slice(0, 10)}.zip`)
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
      <div className="toolbox-watermark-main">
        <section className="toolbox-preview-panel" aria-label="水印预览">
          <div className="toolbox-section-heading">
            <div><strong>水印预览</strong><span>切换下方图片，检查横竖图效果</span></div>
            {currentPreview?.loading && <span>正在更新预览…</span>}
          </div>
          <div className="toolbox-preview-stage">
            {selected ? <img src={currentPreview?.url ?? selected.sourceUrl} alt={`${selected.file.name} 的水印预览`} /> : <p>先添加图片，再设置水印</p>}
          </div>
          {currentPreview?.error && <div className="toolbox-preview-error">预览失败：{currentPreview.error}</div>}
          <p className="toolbox-hint">预览使用缩略尺寸；导出按原图像素处理。图片不会上传到服务器。</p>
        </section>

        <section className="toolbox-settings-panel" aria-label="水印设置">
          <div className="toolbox-section-heading"><div><strong>水印设置</strong><span>一次设置，应用到整批</span></div></div>
          <Radio.Group
            value={settings.kind}
            disabled={controlsLocked}
            onChange={event => updateSettings({ kind: event.target.value })}
            options={[{ label: '文字水印', value: 'text' }, { label: 'Logo 水印', value: 'logo' }]}
            optionType="button"
            buttonStyle="solid"
          />
          {settings.kind === 'text' ? (
            <>
              <label className="toolbox-field-label" htmlFor="watermark-text">水印文字</label>
              <Input id="watermark-text" value={settings.text} maxLength={80} disabled={controlsLocked} placeholder="例如：© 我的品牌" onChange={event => updateSettings({ text: event.target.value })} />
              <div className="toolbox-field-row"><span>文字颜色</span><ColorPicker value={settings.color} disabled={controlsLocked} onChange={color => updateSettings({ color: color.toHexString() })} /></div>
              <label className="toolbox-field-label">文字大小：短边的 {settings.textSizePercent}%</label>
              <Slider min={1} max={15} value={settings.textSizePercent} disabled={controlsLocked} onChange={value => updateSettings({ textSizePercent: value })} />
            </>
          ) : (
            <>
              <label className="toolbox-field-label">Logo 图片</label>
              <Upload accept="image/png,image/webp" showUploadList={false} disabled={controlsLocked} beforeUpload={file => { void chooseLogo(file); return Upload.LIST_IGNORE }}>
                <Button icon={<UploadOutlined />} disabled={controlsLocked}>选择 PNG / WebP</Button>
              </Upload>
              <span className="toolbox-logo-name" title={settings.logoName ?? ''}>{settings.logoName ?? '推荐使用透明背景 Logo'}</span>
              <label className="toolbox-field-label">Logo 宽度：短边的 {settings.logoSizePercent}%</label>
              <Slider min={5} max={50} value={settings.logoSizePercent} disabled={controlsLocked} onChange={value => updateSettings({ logoSizePercent: value })} />
            </>
          )}
          <label className="toolbox-field-label">排列方式</label>
          <Radio.Group
            className="toolbox-layout-options"
            value={settings.layout}
            disabled={controlsLocked}
            onChange={event => updateSettings({ layout: event.target.value })}
            options={[{ label: '单个', value: 'single' }, { label: '平铺', value: 'tile' }]}
            optionType="button"
            buttonStyle="solid"
          />
          {settings.layout === 'tile' ? (
            <>
              <label className="toolbox-field-label">平铺间距：短边的 {settings.tileGapPercent}%</label>
              <Slider min={0} max={30} value={settings.tileGapPercent} disabled={controlsLocked} onChange={value => updateSettings({ tileGapPercent: value })} />
              <label className="toolbox-field-label">旋转角度：{settings.tileRotation}°</label>
              <Slider min={-60} max={60} value={settings.tileRotation} disabled={controlsLocked} onChange={value => updateSettings({ tileRotation: value })} />
            </>
          ) : (
            <>
              <label className="toolbox-field-label">位置</label>
              <div className="toolbox-anchor-grid">
                {anchors.map(anchor => <button key={anchor.value} type="button" className={settings.anchor === anchor.value ? 'is-active' : ''} disabled={controlsLocked} aria-label={anchor.label} title={anchor.label} onClick={() => updateSettings({ anchor: anchor.value })}>{anchor.label}</button>)}
              </div>
            </>
          )}
          <label className="toolbox-field-label">透明度：{settings.opacity}%</label>
          <Slider min={10} max={100} value={settings.opacity} disabled={controlsLocked} onChange={value => updateSettings({ opacity: value })} />
          {settings.layout === 'single' && (
            <>
              <label className="toolbox-field-label">边距：短边的 {settings.marginPercent}%</label>
              <Slider min={0} max={10} value={settings.marginPercent} disabled={controlsLocked} onChange={value => updateSettings({ marginPercent: value })} />
            </>
          )}
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
        </section>
      </div>

      <BatchImageQueue
        items={items.map(item => ({ id: item.id, name: item.file.name, url: item.sourceUrl, width: item.width, height: item.height, status: item.status, error: item.error }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={setSelectedId}
        onRemove={removeFile}
        onClear={clearFiles}
        onRetry={id => { void processImages([id]) }}
        onDownload={downloadOne}
      />

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
