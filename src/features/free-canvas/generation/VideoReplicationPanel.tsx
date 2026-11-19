import { useRef } from 'react'
import { Alert, App, Button, Input, InputNumber, Select, Space } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import type { VideoReplicationDraft } from '@/editor/persistence/types'
import type { ImageAsset, VideoAsset } from '@/editor/types'
import { VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import { VIDEO_REPLICATION_RATIOS } from '@shared/video-replication'
import type { useFreeCanvasGenerationController } from './useFreeCanvasGenerationController'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'

const ratios = { '9:16': '竖屏 9:16', '16:9': '横屏 16:9', '1:1': '方形 1:1' }

interface Props {
  draft: VideoReplicationDraft
  status: ReturnType<typeof useFreeCanvasGenerationController>
  available: boolean
  cloud: boolean
  locked: boolean
  busy: boolean
  error?: string
  preview?: string
  previewError?: string
  referenceExpired: boolean
  product?: ImageAsset
  invalidProduct?: boolean
  referenceChoices: VideoAsset[]
  productChoices: ImageAsset[]
  credits?: number
  balance?: number
  sourceSummary?: string
  onChange: (value: Partial<VideoReplicationDraft>) => void
  onUploadVideo: (file: File) => void
  onUploadImage: (file: File) => void
  onSelectVideo: (id: string) => void
  onReload: () => void
  onGenerate: () => void
}

export default function VideoReplicationPanel(props: Props) {
  const { message } = App.useApp()
  const { draft, status, busy, locked, available, cloud, product, credits, balance } = props
  const videoInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const enabled = available && !cloud
  const disabled = !enabled || locked || busy
  const { referenceExpired } = props
  const task = status.task && 'mode' in status.task.params && status.task.params.mode === 'video_replication' ? status.task : undefined
  const insufficient = credits !== undefined && balance !== undefined && balance < credits

  return <aside className="free-canvas-generation-panel" aria-label="视频复刻表单">
    <div className="free-canvas-panel-body">
      <div>
        <h2>视频复刻</h2>
        <p>参考短片的镜头和节奏，用自己的商品拍一条新视频。</p>
      </div>
      {!enabled && <Alert showIcon type="info" message={cloud ? '请先另存为本地副本，再使用视频复刻' : '视频复刻暂未开放'}
        action={!cloud ? <Button size="small" onClick={props.onReload}>重新检查</Button> : undefined} />}
      {enabled && <>
        <div className="free-canvas-field">
          <strong>参考视频</strong>
          <p className="free-canvas-field-hint">2–15 秒 · 50 MB 以内 · H.264 MP4。请选择以商品和手部为主的画面。</p>
          {draft.reference && <div className="free-canvas-replication-media">
            {props.preview && !referenceExpired && <video key={draft.reference.key} aria-label="参考片预览" src={props.preview} controls muted playsInline preload="metadata" />}
            <span>{draft.reference.name} · {Number(draft.reference.durationSeconds.toFixed(2))} 秒</span>
          </div>}
          {referenceExpired && <Alert showIcon type="warning" message="参考片已过期，请重新上传或选择" />}
          {props.previewError && !referenceExpired && <Alert showIcon type="warning" message={props.previewError} />}
          <Space wrap>
            <Button disabled={disabled} onClick={() => videoInput.current?.click()}>{draft.reference ? '更换参考视频' : '上传参考视频'}</Button>
            <input ref={videoInput} type="file" hidden accept="video/mp4,.mp4" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) props.onUploadVideo(file)
            }} />
            <Select aria-label="从画布选参考视频" placeholder="从画布选视频" disabled={disabled || !props.referenceChoices.length}
              popupMatchSelectWidth={false} options={props.referenceChoices.map(asset => ({ label: asset.name, value: asset.id }))}
              onSelect={props.onSelectVideo} />
          </Space>
        </div>
        <div className="free-canvas-field">
          <strong>商品图</strong>
          {product && <div className="free-canvas-replication-media is-product">
            {!product.missing && !product.loadError && !product.url.includes('__aigc_asset__') && <img src={product.url} alt="已选商品图" />}
            <span>{product.name}</span>
          </div>}
          <Space wrap>
            <Button disabled={disabled} onClick={() => imageInput.current?.click()}>{product ? '更换商品图' : '上传商品图'}</Button>
            <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) props.onUploadImage(file)
            }} />
            <Select aria-label="从画布选商品图" placeholder="从画布选商品图" disabled={disabled || !props.productChoices.length}
              popupMatchSelectWidth={false} options={props.productChoices.map(asset => ({ label: asset.name, value: asset.id }))}
              onSelect={productAssetId => props.onChange({ productAssetId })} />
          </Space>
        </div>
        {props.invalidProduct && <Alert showIcon type="warning" message="请使用每边 300–6000 像素、宽高比在 0.4–2.5 之间的可用商品图" />}
        {busy && <p role="status">正在准备素材…</p>}
        {props.error && <Alert showIcon type="error" message={props.error} />}
        <label className="free-canvas-field">
          <span>补充要求（选填）</span>
          <Input.TextArea data-canvas-prompt rows={2} maxLength={VIDEO_PROMPT_MAX} value={draft.prompt} disabled={disabled}
            placeholder="例如，保持磨砂黑瓶身，背景改成浅木色" onChange={event => props.onChange({ prompt: event.target.value })} />
        </label>
        <div className="free-canvas-replication-settings">
          <label className="free-canvas-field">
            <span>成片时长（秒）</span>
            <InputNumber min={4} max={15} precision={0} value={draft.durationSeconds} disabled={disabled}
              onChange={value => { if (value !== null) props.onChange({ durationSeconds: value }) }} />
          </label>
          <label className="free-canvas-field">
            <span>画幅</span>
            <Select value={draft.ratio} disabled={disabled} options={VIDEO_REPLICATION_RATIOS.map(value => ({ value, label: ratios[value] }))}
              onChange={ratio => props.onChange({ ratio })} />
          </label>
        </div>
        <p className="free-canvas-field-hint">720p · 无声 · 每次生成 1 条</p>
      </>}
      {props.sourceSummary && <p>{props.sourceSummary}</p>}
      <GenerationTaskStatus task={task} submitting={status.submitting} active={status.active && !!task} polling={status.polling && !!task}
        summary={status.preparationPhase ?? task?.errorMessage} submissionError={status.submissionError}
        protocolError={status.protocolError} pollError={status.pollError} historySaved={!!task && status.historySaved}
        historyError={status.historyError} onRetrySave={status.retryHistory}
        onModifyParameters={status.modifyParameters} onRefetch={() => { void status.refetch() }} />
      {status.submissionError?.includes('价格已更新') && <Button onClick={props.onReload}>重新读取报价</Button>}
      {task?.status === 'succeeded' && task.resultVideos?.[0] && <Button onClick={() => {
        const video = task.resultVideos?.[0]
        if (video) void downloadOwnedVideo(video, '视频复刻.mp4').catch(error => {
          message.error(error instanceof Error ? error.message : '成片下载失败')
        })
      }}>下载成片</Button>}
    </div>
    {enabled && <div className="free-canvas-panel-footer">
      <p aria-live="polite">{credits === undefined ? '选择两份素材后查看积分报价' : `本次预计消耗 ${credits} 积分`}</p>
      {insufficient && <p role="status" className="free-canvas-credit-warning">可用积分不足</p>}
      <Button type="primary" block className="free-canvas-generate" data-task-generate loading={status.submitting}
        disabled={disabled || !product || !props.preview || referenceExpired || credits === undefined || insufficient}
        onClick={props.onGenerate}>生成复刻视频</Button>
    </div>}
  </aside>
}
