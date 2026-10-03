import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Progress, Radio, Switch } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { useUserStore } from '@/store/useUserStore'
import PreviewGallery from '@/components/PreviewGallery'
import { useBlobPreviewGallery } from '@/components/useBlobPreviewGallery'
import { usePipelineStore } from '@/features/toolbox-pipeline/store'
import { initializePipeline, pausePipeline, startPipeline, forgetPipelineImage, clearPipelineCache } from '@/features/toolbox-pipeline/runtime'
import { finalMime, itemStatus, type PipelineItem } from '@/features/toolbox-pipeline/types'
import { pipelineNames, createPipelineZip } from '@/features/toolbox-pipeline/download'
import { usePipelineUrls } from '@/features/toolbox-pipeline/usePipelineUrls'
import { usePipelinePreview, type PreviewStage } from '@/features/toolbox-pipeline/usePipelinePreview'
import BatchImageUpload from './BatchImageUpload'
import BatchImageQueue from './BatchImageQueue'
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
const phaseLabels = { detect: '正在识别主体', ratio: '正在转比例', watermark: '正在加水印', encode: '正在生成成品' }
const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作失败'

export default function PipelineTool() {
  const { message } = App.useApp()
  const state = usePipelineStore()
  const ownerId = useUserStore(user => user.userId ?? 'local')
  const { items, settings, selectedId, runState, stopping } = state
  const [stage, setStage] = useState<PreviewStage>('final')
  const [adding, setAdding] = useState(false)
  const [packaging, setPackaging] = useState(false)
  const pending = useRef({ count: 0, bytes: 0 })
  const additions = useRef<Promise<void>>(Promise.resolve())
  const mounted = useRef(false)
  const processing = runState === 'running' || stopping
  const busy = processing || adding || packaging
  const urls = usePipelineUrls(items)
  const selected = items.find(item => item.id === selectedId)
  const preview = usePipelinePreview(selected, settings, stage, processing)
  const completed = items.filter(item => itemStatus(item) === 'succeeded')
  const failed = items.filter(item => itemStatus(item) === 'failed')
  const gallerySources = useMemo(() => items.map(item => ({ id: item.id, file: item.file, sourceUrl: urls.get(item.file) ?? '', output: item.output?.blob })), [items, urls])
  const ratioSources = useMemo(() => items.map(item => ({ id: item.id, file: item.file, sourceUrl: urls.get(item.file) ?? '', output: item.intermediate?.blob })), [items, urls])
  const finalGallery = useBlobPreviewGallery(gallerySources)
  const ratioGallery = useBlobPreviewGallery(ratioSources)
  const preset = PLATFORM_SIZE_PRESETS.find(preset => preset.id === settings.aspectRatio.selectedPresetId)!
  const outputBytes = completed.reduce((sum, item) => sum + (item.output?.blob.size ?? 0), 0)
  const watermarkValid = !settings.watermarkEnabled || hasWatermark(settings.watermark)
  const fallbackCount = completed.filter(item => item.cropFocus?.source === 'grid').length
  const shownArtifact = stage === 'ratio' ? selected?.intermediate : stage === 'final' ? selected?.output : undefined
  const shownSize = stage === 'original' && selected ? selected : shownArtifact ?? preset
  const shownUrl = preview?.url ?? (shownArtifact ? urls.get(shownArtifact.blob) : undefined) ?? (selected ? urls.get(selected.file) : undefined)

  useEffect(() => {
    mounted.current = true
    initializePipeline()
    return () => { mounted.current = false; pausePipeline() }
  }, [ownerId])

  function updateRatio(patch: Partial<AspectRatioSettings>) {
    if (busy || patch.strategy === 'outpaint') return
    state.updateRatio({ ...patch, strategy: patch.strategy ?? settings.aspectRatio.strategy })
  }

  function addFile(file: File) {
    if (processing || packaging) return
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
    try { await startPipeline(ids) } catch (error) { if (mounted.current) message.error(errorMessage(error)) }
  }

  async function chooseLogo(file: File) {
    const owner = usePipelineStore.getState().ownerId
    const revision = usePipelineStore.getState().revision
    try {
      await inspectLogo(file)
      if (mounted.current && usePipelineStore.getState().ownerId === owner && usePipelineStore.getState().revision === revision) state.updateWatermark({ logo: file, logoName: file.name })
    } catch (error) { if (mounted.current && usePipelineStore.getState().ownerId === owner) message.error(errorMessage(error)) }
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

  function queueNote(item: PipelineItem) {
    if (item.phase) return phaseLabels[item.phase]
    if (item.cropFocus?.source === 'grid') return item.cropFocus.note
    if (itemStatus(item) === 'succeeded') return item.watermarkStatus === 'skipped' ? '转比例完成 · 已跳过水印' : '转比例完成 · 水印完成'
    if (item.intermediate) return '转比例完成 · 等待生成成品'
    return runState === 'paused' ? '已暂停 · 等待继续处理' : '等待转比例'
  }

  return <div className="toolbox-watermark toolbox-pipeline">
    <div className="toolbox-section-heading"><div><strong>转比例 → 加水印</strong><span>一次设置，自动处理整批图片</span></div></div>
    <BatchImageUpload count={items.length} disabled={busy} onAdd={addFile}
      processingHint={settings.aspectRatio.strategy === 'crop' ? '智能裁剪可能上传缩略图识别主体，水印在本机处理' : '转比例与水印在本机处理'} />
    <div className="toolbox-watermark-main">
      <section className="toolbox-preview-panel" aria-label="流水线预览">
        <div className="toolbox-section-heading"><div><strong>效果预览</strong><span>{preset.label} · {shownSize.width} × {shownSize.height}{selected ? ` · ${finalMime(selected, settings) === 'image/png' ? 'PNG' : 'JPEG'}` : ''}</span></div></div>
        <Radio.Group value={stage} onChange={event => setStage(event.target.value)} optionType="button" buttonStyle="solid"
          options={[{ label: '原图', value: 'original' }, { label: '转比例', value: 'ratio' }, { label: '最终效果', value: 'final' }]} />
        <div className="toolbox-preview-stage">
          {selected && shownUrl ? <img src={shownUrl} alt={`${selected.file.name} 的流水线预览`}
            onClick={shownArtifact ? () => (stage === 'ratio' ? ratioGallery : finalGallery).openAt(selected.id) : undefined} style={{ cursor: shownArtifact ? 'zoom-in' : undefined }} /> : <p>先添加图片，再配置转比例和水印</p>}
        </div>
        {preview?.loading && <p className="toolbox-hint" role="status">正在更新预览…</p>}
        {preview?.error && <p className="toolbox-preview-error">预览失败：{preview.error}</p>}
        <p className="toolbox-hint">预览最长边不超过 800 px，成品按平台精确尺寸导出。切页会暂停，返回后可继续；刷新或关闭后需重新上传。</p>
        {settings.aspectRatio.strategy === 'crop' && !selected?.intermediate && <p className="toolbox-hint">预览按九宫格展示；处理时识别主体，实际裁剪位置可能调整。</p>}
        {!watermarkValid && <p className="toolbox-hint toolbox-warning">请先填写水印文字或选择 Logo，也可以关闭水印。</p>}
        {runState === 'paused' && <p className="toolbox-hint" role="status">{stopping ? '正在暂停处理…' : '已暂停，成功步骤已保留，可继续处理。'}</p>}
      </section>
      <div className="toolbox-pipeline-settings">
        <AspectRatioSettingsPanel settings={settings.aspectRatio} disabled={busy} onChange={updateRatio} allowedStrategies={allowedStrategies}
          templates={<PresetControls key={ownerId} scope={ownerId} settings={settings.aspectRatio as AspectRatioSettings} api={ratioApi} disabled={busy} onApply={updateRatio} accepts={acceptsRatio} />} />
        <div className="toolbox-pipeline-watermark-toggle"><strong>加水印</strong><Switch checked={settings.watermarkEnabled} disabled={busy} aria-label="启用水印" onChange={state.enableWatermark} /></div>
        {settings.watermarkEnabled && <WatermarkSettingsPanel settings={settings.watermark} disabled={busy} onChange={state.updateWatermark} onLogo={chooseLogo}
          templates={<PresetControls key={ownerId} scope={ownerId} settings={settings.watermark} api={watermarkApi} disabled={busy} onApply={state.updateWatermark} validate={() => hasWatermark(settings.watermark)} />} />}
      </div>
    </div>
    <BatchImageQueue items={items.map(item => {
      const artifact = item.output ?? item.intermediate
      return { id: item.id, name: item.file.name, url: urls.get(artifact?.blob ?? item.file) ?? '',
        width: artifact?.width ?? item.width, height: artifact?.height ?? item.height,
        status: itemStatus(item), error: item.error, note: queueNote(item),
        noteWarning: item.cropFocus?.source === 'grid', canRetry: itemStatus(item) === 'succeeded' && item.cropFocus?.source === 'grid' }
    })} selectedId={selectedId} disabled={busy} onSelect={state.select}
      onRemove={id => { const item = items.find(item => item.id === id); if (item) forgetPipelineImage(item.file); state.remove(id) }}
      onClear={() => { clearPipelineCache(); state.clear() }} onRetry={id => void process([id])} onDownload={downloadOne}
      onPreviewResult={finalGallery.openAt} />
    <PreviewGallery {...finalGallery.galleryProps} onDownload={item => downloadOne(item.id)} />
    <PreviewGallery {...ratioGallery.galleryProps} onDownload={item => {
      const intermediate = items.find(candidate => candidate.id === item.id)?.intermediate
      if (!intermediate) return
      try {
        const candidates = items.filter(candidate => candidate.intermediate).map(candidate => ({ ...candidate, output: candidate.intermediate }))
        downloadBlob(intermediate.blob, pipelineNames(candidates, { ...settings, watermarkEnabled: false }).get(item.id)!)
      } catch (error) { message.error(errorMessage(error)) }
    }} />
    <div className="toolbox-watermark-footer">
      {fallbackCount > 0 && <p className="toolbox-hint toolbox-warning toolbox-crop-warning">{fallbackCount} 张按九宫格裁剪，请检查成品；可在对应图片上单独重试。</p>}
      <div className="toolbox-progress"><span>{completed.length} / {items.length} 张已完成{failed.length ? ` · ${failed.length} 张失败` : ''}</span>
        {processing && <Progress size="small" percent={items.length ? Math.round(completed.length / items.length * 100) : 0} showInfo={false} />}
        {outputBytes > MAX_ZIP_BYTES && <span className="toolbox-warning">结果超过 200 MB，请逐张下载</span>}
      </div>
      <div className="toolbox-footer-actions">
        <Button icon={<DownloadOutlined />} disabled={!completed.length || busy || outputBytes > MAX_ZIP_BYTES} loading={packaging} onClick={() => void downloadAll()}>打包下载</Button>
        {!!failed.length && <Button disabled={busy} onClick={() => void process(failed.map(item => item.id))}>重试失败项</Button>}
        {runState === 'running' ? <Button danger onClick={pausePipeline}>暂停处理</Button> :
          <Button type="primary" disabled={busy || !watermarkValid || !items.some(item => itemStatus(item) !== 'succeeded')} onClick={() => void process()}>{runState === 'paused' ? '继续处理' : '开始处理'}</Button>}
      </div>
    </div>
  </div>
}
