import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, App, Button, Input, InputNumber, Select, Space } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import type { VideoReplicationDraft } from '@/editor/persistence/types'
import type { ImageAsset, VideoAsset } from '@/editor/types'
import { translateApiError } from '@/i18n/apiErrors'
import { formatMegabytes } from '@/i18n/format'
import { VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import { VIDEO_REPLICATION_RATIOS } from '@shared/video-replication'
import type { useFreeCanvasGenerationController } from './useFreeCanvasGenerationController'
import { downloadOwnedVideo } from '@/services/api/ownedVideos'

const RATIO_KEYS = {
  '9:16': 'replication.ratios.9:16',
  '16:9': 'replication.ratios.16:9',
  '1:1': 'replication.ratios.1:1',
} as const

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
  const { t } = useTranslation('canvas')
  const { message } = App.useApp()
  const { draft, status, busy, locked, available, cloud, product, credits, balance } = props
  const videoInput = useRef<HTMLInputElement>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const enabled = available && !cloud
  const disabled = !enabled || locked || busy
  const { referenceExpired } = props
  const task = status.task && 'mode' in status.task.params && status.task.params.mode === 'video_replication' ? status.task : undefined
  const insufficient = credits !== undefined && balance !== undefined && balance < credits
  const taskErrorSummary = task?.errorMessage
    ? translateApiError({ code: task.errorCode, message: task.errorMessage, fallback: t('panel.taskIncompleteFallback') })
    : undefined

  return <aside className="free-canvas-generation-panel" aria-label={t('replication.formAria')}>
    <div className="free-canvas-panel-body">
      <div>
        <h2>{t('replication.title')}</h2>
        <p>{t('replication.subtitle')}</p>
      </div>
      {!enabled && <Alert showIcon type="info" message={cloud ? t('replication.cloudNotice') : t('replication.unavailable')}
        action={!cloud ? <Button size="small" onClick={props.onReload}>{t('replication.recheck')}</Button> : undefined} />}
      {enabled && <>
        <div className="free-canvas-field">
          <strong>{t('replication.referenceVideo')}</strong>
          <p className="free-canvas-field-hint">{t('replication.referenceHint', { maxSize: formatMegabytes(50 * 1024 * 1024) })}</p>
          {draft.reference && <div className="free-canvas-replication-media">
            {props.preview && !referenceExpired && <video key={draft.reference.key} aria-label={t('replication.referencePreviewAria')} src={props.preview} controls muted playsInline preload="metadata" />}
            <span>{draft.reference.name} · {t('panel.durationSeconds', { count: Number(draft.reference.durationSeconds.toFixed(2)) })}</span>
          </div>}
          {referenceExpired && <Alert showIcon type="warning" message={t('replication.referenceExpired')} />}
          {props.previewError && !referenceExpired && <Alert showIcon type="warning" message={props.previewError} />}
          <Space wrap>
            <Button disabled={disabled} onClick={() => videoInput.current?.click()}>{draft.reference ? t('replication.replaceReference') : t('replication.uploadReference')}</Button>
            <input ref={videoInput} type="file" hidden accept="video/mp4,.mp4" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) props.onUploadVideo(file)
            }} />
            <Select aria-label={t('replication.selectReferenceAria')} placeholder={t('replication.selectReferencePlaceholder')} disabled={disabled || !props.referenceChoices.length}
              popupMatchSelectWidth={false} options={props.referenceChoices.map(asset => ({ label: asset.name, value: asset.id }))}
              onSelect={props.onSelectVideo} />
          </Space>
        </div>
        <div className="free-canvas-field">
          <strong>{t('replication.productImage')}</strong>
          {product && <div className="free-canvas-replication-media is-product">
            {!product.missing && !product.loadError && !product.url.includes('__aigc_asset__') && <img src={product.url} alt={t('replication.selectedProductAlt')} />}
            <span>{product.name}</span>
          </div>}
          <Space wrap>
            <Button disabled={disabled} onClick={() => imageInput.current?.click()}>{product ? t('replication.replaceProduct') : t('replication.uploadProduct')}</Button>
            <input ref={imageInput} type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={event => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) props.onUploadImage(file)
            }} />
            <Select aria-label={t('replication.selectProductAria')} placeholder={t('replication.selectProductPlaceholder')} disabled={disabled || !props.productChoices.length}
              popupMatchSelectWidth={false} options={props.productChoices.map(asset => ({ label: asset.name, value: asset.id }))}
              onSelect={productAssetId => props.onChange({ productAssetId })} />
          </Space>
        </div>
        {props.invalidProduct && <Alert showIcon type="warning" message={t('replication.invalidProduct')} />}
        {busy && <p role="status">{t('replication.preparingMedia')}</p>}
        {props.error && <Alert showIcon type="error" message={props.error} />}
        <label className="free-canvas-field">
          <span>{t('replication.promptLabel')}</span>
          <Input.TextArea data-canvas-prompt rows={2} maxLength={VIDEO_PROMPT_MAX} value={draft.prompt} disabled={disabled}
            placeholder={t('replication.promptPlaceholder')} onChange={event => props.onChange({ prompt: event.target.value })} />
        </label>
        <div className="free-canvas-replication-settings">
          <label className="free-canvas-field">
            <span>{t('replication.durationLabel')}</span>
            <InputNumber min={4} max={15} precision={0} value={draft.durationSeconds} disabled={disabled}
              onChange={value => { if (value !== null) props.onChange({ durationSeconds: value }) }} />
          </label>
          <label className="free-canvas-field">
            <span>{t('replication.ratioLabel')}</span>
            <Select value={draft.ratio} disabled={disabled} options={VIDEO_REPLICATION_RATIOS.map(value => ({ value, label: t(RATIO_KEYS[value]) }))}
              onChange={ratio => props.onChange({ ratio })} />
          </label>
        </div>
        <p className="free-canvas-field-hint">{t('replication.specHint')}</p>
      </>}
      {props.sourceSummary && <p>{props.sourceSummary}</p>}
      <GenerationTaskStatus task={task} submitting={status.submitting} active={status.active && !!task} polling={status.polling && !!task}
        summary={status.preparationPhase ?? taskErrorSummary} submissionError={status.submissionError}
        protocolError={status.protocolError} pollError={status.pollError} historySaved={!!task && status.historySaved}
        historyError={status.historyError} onRetrySave={status.retryHistory}
        onModifyParameters={status.modifyParameters} onRefetch={() => { void status.refetch() }} />
      {status.submissionError?.toLowerCase().includes(t('replication.priceChangedKeyword').toLowerCase()) && <Button onClick={props.onReload}>{t('replication.reloadQuote')}</Button>}
      {task?.status === 'succeeded' && task.resultVideos?.[0] && <Button onClick={() => {
        const video = task.resultVideos?.[0]
        if (video) void downloadOwnedVideo(video, t('replication.downloadFilename')).catch(error => {
          message.error(error instanceof Error ? error.message : t('replication.downloadFailed'))
        })
      }}>{t('replication.downloadResult')}</Button>}
    </div>
    {enabled && <div className="free-canvas-panel-footer">
      <p aria-live="polite">{credits === undefined ? t('replication.selectTwoInputsHint') : t('replication.estimatedCredits', { credits })}</p>
      {insufficient && <p role="status" className="free-canvas-credit-warning">{t('replication.insufficientCredits')}</p>}
      <Button type="primary" block className="free-canvas-generate" data-task-generate loading={status.submitting}
        disabled={disabled || !product || !props.preview || referenceExpired || credits === undefined || insufficient}
        onClick={props.onGenerate}>{t('replication.generateButton')}</Button>
    </div>}
  </aside>
}
