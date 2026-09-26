import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { App, Button, ColorPicker, Input, Progress, Radio, Select } from 'antd'
import { DownloadOutlined, SaveOutlined } from '@ant-design/icons'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { useUserStore } from '@/store/useUserStore'
import BatchImageQueue from './BatchImageQueue'
import { invalidateBatch, processBatch } from './aspect-ratio/batch'
import { createAspectRatioZip, downloadBlob, namesForImages } from './aspect-ratio/download'
import { fitScale } from './aspect-ratio/geometry'
import { setOutpaintHandoff } from './aspect-ratio/handoff'
import { expansionPlan, processOutpaintBatch } from './aspect-ratio/expansion'
import { expandRemoteImage } from './aspect-ratio/outpaintClient'
import { readPrefs, writePrefs } from './aspect-ratio/prefs'
import { deletePreset, listPresets, savePreset, type AspectRatioPreset } from './aspect-ratio/presets'
import { AspectRatioRenderer } from './aspect-ratio/renderer'
import { detectImageSubject } from './aspect-ratio/subjectClient'
import { cropProgressLabel } from './aspect-ratio/subjectFocus'
import { DEFAULT_ASPECT_RATIO_SETTINGS, PREVIEW_MAX_DIMENSION, type AspectRatioSettings, type BatchImage } from './aspect-ratio/types'
import { inspectImage, MAX_ZIP_BYTES, queueLimitMessage } from './shared/inspect'

const focuses = [
  { fx: 0, fy: 0, label: '左上' },
  { fx: 0.5, fy: 0, label: '上中' },
  { fx: 1, fy: 0, label: '右上' },
  { fx: 0, fy: 0.5, label: '左中' },
  { fx: 0.5, fy: 0.5, label: '正中' },
  { fx: 1, fy: 0.5, label: '右中' },
  { fx: 0, fy: 1, label: '左下' },
  { fx: 0.5, fy: 1, label: '下中' },
  { fx: 1, fy: 1, label: '右下' },
]

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
  const itemsRef = useRef<BatchImage[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [settings, setSettings] = useState<AspectRatioSettings>(DEFAULT_ASPECT_RATIO_SETTINGS)
  const settingsRef = useRef(settings)
  const [prefsReady, setPrefsReady] = useState(false)
  const [previewState, setPreviewState] = useState<PreviewState | null>(null)
  const previewUrlRef = useRef<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const processingRef = useRef(false)
  const cancelledRef = useRef(false)
  const mountedRef = useRef(true)
  const rendererRef = useRef<AspectRatioRenderer | null>(null)
  const addChainRef = useRef<Promise<void>>(Promise.resolve())
  const addingCountRef = useRef(0)
  const pendingBytesRef = useRef(0)
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const [presets, setPresets] = useState<AspectRatioPreset[]>([])
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null)
  const [presetName, setPresetName] = useState('')

  const preset = PLATFORM_SIZE_PRESETS.find(item => item.id === settings.selectedPresetId) ?? PLATFORM_SIZE_PRESETS[0]
  const selected = items.find(item => item.id === selectedId)
  const completed = items.filter(item => item.status === 'succeeded')
  const failed = items.filter(item => item.status === 'failed')
  const gridFallbacks = items.filter(item => item.status === 'succeeded' && item.cropFocus?.source === 'grid' && item.cropFocus.note)
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

  function renderer() {
    if (!rendererRef.current) rendererRef.current = new AspectRatioRenderer()
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
    void readPrefs(scope).then(stored => {
      if (!active) return
      settingsRef.current = stored
      setSettings(stored)
      setPrefsReady(true)
    }).catch(error => {
      if (active) message.warning(`读取上次选择失败：${errorMessage(error)}`)
      setPrefsReady(true)
    })
    void listPresets(scope).then(records => {
      if (active) setPresets(records)
    }).catch(error => { if (active) message.warning(`读取本机模板失败：${errorMessage(error)}`) })
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
    if (processingRef.current || addingCountRef.current) return
    const targets = itemsRef.current.filter(item => (onlyIds ? onlyIds.includes(item.id) : item.status !== 'succeeded'))
    if (!targets.length) return
    processingRef.current = true
    cancelledRef.current = false
    setProcessing(true)
    try {
      if (settings.strategy === 'outpaint') {
        await processOutpaintBatch({
          images: itemsRef.current,
          settings,
          targetWidth: preset.width,
          targetHeight: preset.height,
          ids: onlyIds,
          renderLocal: image => renderer().render({
            file: image.file,
            settings: { ...settings, strategy: 'letterbox', background: '#ffffff' },
            targetWidth: preset.width,
            targetHeight: preset.height,
          }),
          expandRemote: (image, plan) => expandRemoteImage(image, plan, preset.width, preset.height, () => cancelledRef.current || !mountedRef.current),
          update: (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
          shouldStop: () => cancelledRef.current || !mountedRef.current,
        })
      } else {
        await processBatch({
          images: itemsRef.current,
          settings,
          targetWidth: preset.width,
          targetHeight: preset.height,
          ids: onlyIds,
          detect: image => detectImageSubject(image),
          render: request => renderer().render(request),
          update: (id, patch) => commitItems(itemsRef.current.map(item => item.id === id ? { ...item, ...patch } : item)),
          shouldStop: () => cancelledRef.current || !mountedRef.current,
        })
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

  function refineFailed(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item || settingsRef.current.strategy !== 'outpaint') return
    setOutpaintHandoff({ file: item.file, presetId: preset.id })
    navigate('/image-workstation/outpaint')
  }

  function downloadOne(id: string) {
    const item = itemsRef.current.find(candidate => candidate.id === id)
    if (!item?.output) return
    const names = namesForImages(itemsRef.current.filter(candidate => candidate.status === 'succeeded'), preset.id)
    downloadBlob(item.output, names.get(id)!)
  }

  async function downloadAll() {
    if (packaging) return
    setPackaging(true)
    try {
      const blob = await createAspectRatioZip(itemsRef.current, preset.id)
      downloadBlob(blob, `aspect-ratio_${preset.id}_${new Date().toISOString().slice(0, 10)}.zip`)
    } catch (error) {
      message.error(errorMessage(error))
    } finally {
      if (mountedRef.current) setPackaging(false)
    }
  }

  return (
    <div className="toolbox-watermark">
      <div className="toolbox-watermark-main">
        <section className="toolbox-preview-panel" aria-label="转比例预览">
          <div className="toolbox-section-heading">
            <div><strong>转比例预览</strong><span>{preset.label} {preset.width} × {preset.height}</span></div>
            {currentPreview?.loading && <span>正在更新预览…</span>}
          </div>
          <div className="toolbox-preview-stage">
            {selected ? <img src={currentPreview?.url ?? selected.sourceUrl} alt={`${selected.file.name} 的转比例预览`} /> : <p>先添加图片，再选择平台和适配方式</p>}
          </div>
          {currentPreview?.error && <div className="toolbox-preview-error">预览失败：{currentPreview.error}</div>}
          <p className="toolbox-hint">预览最长边不超过 {PREVIEW_MAX_DIMENSION}px；导出为 {preset.width} × {preset.height}。图片在本机处理。</p>
          {upscale > 2 && <p className="toolbox-hint toolbox-warning">当前图片需要放大超过 2 倍才能铺满目标尺寸，细节可能变糊。</p>}
        </section>

        <section className="toolbox-settings-panel" aria-label="转比例设置">
          <div className="toolbox-section-heading"><div><strong>转比例设置</strong><span>一次设置，应用到整批</span></div></div>
          <label className="toolbox-field-label">目标平台</label>
          <Radio.Group
            value={preset.id}
            disabled={controlsLocked}
            onChange={event => updateSettings({ selectedPresetId: event.target.value })}
          >
            {PLATFORM_SIZE_PRESETS.map(item => (
              <Radio key={item.id} value={item.id} style={{ display: 'flex', marginBottom: 6 }}>
                {item.label} {item.width} × {item.height}
              </Radio>
            ))}
          </Radio.Group>
          <label className="toolbox-field-label">适配策略</label>
          <Radio.Group
            value={settings.strategy}
            disabled={controlsLocked}
            onChange={event => updateSettings({ strategy: event.target.value })}
            options={[
              { label: '留白填充', value: 'letterbox' },
              { label: '智能裁剪', value: 'crop' },
              { label: '智能扩展', value: 'outpaint' },
            ]}
          />
          {settings.strategy === 'letterbox' && <p className="toolbox-hint">留白会把原图完整放进目标尺寸，空白处用所选颜色填上。</p>}
          {settings.strategy === 'outpaint' && (
            <p className="toolbox-hint">
              智能扩展会提交 {items.filter(item => expansionPlan(item.width, item.height, preset.width, preset.height).mode === 'remote').length} 个扩图任务。比例已经一致的图片只在本机缩放。预览里的深色区域是待补全的留白。
            </p>
          )}
          {settings.strategy === 'letterbox' && (
            <>
              <div className="toolbox-field-row">
                <span>留白颜色</span>
                <ColorPicker value={settings.background === 'transparent' ? '#ffffff' : settings.background} disabled={controlsLocked || settings.background === 'transparent'} onChange={color => updateSettings({ background: color.toHexString() })} />
              </div>
              <Radio.Group
                value={settings.background === 'transparent' ? 'transparent' : 'color'}
                disabled={controlsLocked}
                onChange={event => updateSettings({ background: event.target.value === 'transparent' ? 'transparent' : '#ffffff' })}
                options={[{ label: '纯色', value: 'color' }, { label: '透明 PNG', value: 'transparent' }]}
                optionType="button"
              />
            </>
          )}
          {settings.strategy === 'crop' && (
            <>
              <label className="toolbox-field-label">裁剪焦点</label>
              <div className="toolbox-anchor-grid">
                {focuses.map(focus => (
                  <button
                    key={focus.label}
                    type="button"
                    className={settings.fx === focus.fx && settings.fy === focus.fy ? 'is-active' : ''}
                    disabled={controlsLocked}
                    onClick={() => updateSettings({ fx: focus.fx, fy: focus.fy })}
                  >
                    {focus.label}
                  </button>
                ))}
              </div>
              <p className="toolbox-hint">处理时识别商品主体并按主体裁剪。识别不到或检测失败时，按当前九宫格裁完，这一张仍算成功。队列里出现黄色提示时，先把焦点改到商品所在位置，再重新处理。</p>
            </>
          )}
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
        </section>
      </div>

      <BatchImageQueue
        items={items.map(item => ({
          id: item.id, name: item.file.name, url: item.sourceUrl, width: item.width, height: item.height, status: item.status, error: item.error,
          note: item.status === 'processing' && settings.strategy === 'crop' ? '正在识别商品主体…' : item.cropFocus?.note,
          noteWarning: item.status !== 'processing' && item.cropFocus?.source === 'grid',
        }))}
        selectedId={selectedId}
        disabled={busy}
        onAdd={addFile}
        onSelect={setSelectedId}
        onRemove={removeFile}
        onClear={clearFiles}
        onRetry={id => { void processImages([id]) }}
        onDownload={downloadOne}
        onRefine={settings.strategy === 'outpaint' ? refineFailed : undefined}
      />

      <div className="toolbox-watermark-footer">
        {settings.strategy === 'crop' && gridFallbacks.length > 0 && <p className="toolbox-hint toolbox-warning toolbox-crop-warning">{gridFallbacks.length} 张没有按商品裁剪，用的是当前九宫格。下载前请把焦点改到商品所在位置，再重新处理。</p>}
        <div className="toolbox-progress">
          <span className="toolbox-progress-status">{processing && settings.strategy === 'crop' ? cropProgressLabel(completed.length, items.length, processingItems.map(item => item.file.name)) : `${completed.length} / ${items.length} 张已完成`}</span>
          {processing && <Progress size="small" status="active" percent={Math.max(donePercent, 8)} showInfo={false} />}
          {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
        </div>
        <div className="toolbox-footer-actions">
          <Button icon={<DownloadOutlined />} disabled={!completed.length || processing || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>打包下载</Button>
          {failed.length > 0 && !processing && <Button disabled={busy} onClick={() => void processImages(failed.map(item => item.id))}>重试失败项</Button>}
          {processing ? <Button danger onClick={cancelProcessing}>取消处理</Button> : (
            <Button type="primary" disabled={!items.some(item => item.status !== 'succeeded') || busy} onClick={() => void processImages()}>开始处理</Button>
          )}
        </div>
      </div>
    </div>
  )
}
