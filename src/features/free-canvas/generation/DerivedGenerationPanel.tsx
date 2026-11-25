import { useTranslation } from 'react-i18next'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Input, Radio, Spin, Tooltip } from 'antd'
import ModelChoice from '@/components/ModelChoice'
import GenerationCountPicker from '@/components/GenerationCountPicker'
import { matchImageModel } from '@shared/image-models'
import { VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewResultStrip from '@/components/PreviewResultStrip'
import { downloadImageSource, extensionForMime } from '@/features/image-workstation/download'
import { translateApiError } from '@/i18n/apiErrors'
import type { Asset, ImageAsset } from '@/editor/types'
import type { PublicImageModel } from '@/services/api/imageModels'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useUserStore } from '@/store/useUserStore'
import type { GenerationTask } from '@/types'
import type { CanvasGenerationTaskParams } from './requestBuilder'
import { resultAssetForTask } from './resultAsset'
import VideoCreditEstimate from './VideoCreditEstimate'
import VideoGenerationSettings from './VideoGenerationSettings'
import { videoCreditBlocksSubmit, videoCreditsForDuration } from './videoCredits'
import type { VideoModelProfile, VideoResolution } from '@shared/video-models'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { creditQuote, imageCreditAmount } from '@/features/credits/quotes'
import { insufficientCreditsReason, imageCreditBlocksSubmit } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { modelProfileIdForRetry } from './retryModel'
import { videoRetryParametersSupported } from './videoParameters'
import type { CapabilityAvailability } from '@/components/capabilityAvailability'
import VideoAvailabilityNotice from './VideoAvailabilityNotice'
import { taskFailureText } from '@/features/generation/providerErrorCopy'

export type DerivedGenerationMode = 'variation' | 'image-to-video'

interface DerivedGenerationPanelProps {
  mode: DerivedGenerationMode
  sourceAsset: ImageAsset
  prompt: string
  count: number
  durationSeconds: number
  generateAudio?: boolean
  onAudioChange?: (value: boolean) => void
  videoConfigured?: boolean
  videoModel?: VideoModelProfile
  videoModels?: VideoModelProfile[]
  videoResolution?: VideoResolution
  selectedVideoModelId?: string
  onVideoModelChange?: (id: string) => void
  onVideoResolutionChange?: (resolution: VideoResolution) => void
  videoAvailability?: CapabilityAvailability
  onReloadModels?: () => void
  task?: GenerationTask<CanvasGenerationTaskParams>
  submitting: boolean
  autoRetrying: boolean
  active: boolean
  formLocked: boolean
  polling: boolean
  submissionError?: string
  protocolError?: string
  pollError?: Error | null
  onBack: () => void
  onPromptChange: (prompt: string) => void
  onCountChange: (count: number) => void
  onDurationChange: (durationSeconds: number) => void
  onGenerate: () => void
  generateDisabled?: boolean
  modelsLoading?: boolean
  onRetry: () => void
  onModifyParameters: () => void
  onRefetch: () => void
  models?: PublicImageModel[]
  modelProfileId?: string
  resolution?: '1k' | '2k' | '4k'
  onModelChange?: (value: string) => void
  onResolutionChange?: (value: '1k' | '2k' | '4k') => void
  estimatedCredits?: number
  mockGateway?: boolean
  resolutionAdjusted?: boolean
  preparationPhase?: string
  historyError?: string
  historySaved?: boolean
  onRetrySave?: () => void
  resultAssets?: Record<string, Asset>
}

export default function DerivedGenerationPanel({
  mode,
  sourceAsset,
  prompt,
  count,
  durationSeconds,
  task,
  submitting,
  autoRetrying,
  active,
  formLocked,
  polling,
  submissionError,
  protocolError,
  pollError,
  onBack,
  onPromptChange,
  onCountChange,
  onDurationChange,
  onGenerate,
  generateDisabled = false,
  modelsLoading = false,
  onRetry,
  onModifyParameters,
  onRefetch,
  models = [], modelProfileId, resolution = '2k', onModelChange, onResolutionChange,
  estimatedCredits, mockGateway = true, resolutionAdjusted = false, preparationPhase,
  historyError, historySaved, onRetrySave, resultAssets,
  generateAudio = false, onAudioChange, videoConfigured = false, videoModel,
  videoModels, videoResolution, selectedVideoModelId, onVideoModelChange, onVideoResolutionChange,
  videoAvailability, onReloadModels,
}: DerivedGenerationPanelProps) {
  const { t } = useTranslation('canvas')
  const imageToVideo = mode === 'image-to-video'
  const balance = useUserStore(state => state.credits)
  const knownBalance = useKnownCreditBalance()
  const title = imageToVideo ? t('derived.imageToVideoTitle') : t('derived.variationTitle')
  const taskFailureSummary = task?.status === 'failed' || task?.status === 'cancelled'
    ? translateApiError({
      code: task.errorCode,
      message: taskFailureText(task.errorCode, task.errorMessage, t('panel.taskIncompleteFallback')),
      fallback: t('panel.taskIncompleteFallback'),
    })
    : undefined
  const summary = autoRetrying
    ? t('derived.autoRetrying')
    : task?.status === 'succeeded'
      ? imageToVideo
        ? t('panel.videoAddedSummary')
        : t('derived.variationSucceededSummary', {
          succeeded: task.resultImages?.length ?? task.resultUrls?.length ?? 0,
          total: task.params.count,
          costSuffix: mockGateway ? '' : t('panel.actualCostSuffix', { credits: task.creditsCost }),
        })
      : taskFailureSummary
        ?? (imageToVideo
          ? t('panel.currentVideoCount', { duration: durationSeconds })
          : t('derived.currentVariationCount', { count }))
  const resultUrls = task?.resultVideos?.length ? task.resultVideos.map(video => video.url) : task?.resultImages?.length ? task.resultImages.map(image => image.url) : task?.resultUrls ?? []
  const previewItems = resultUrls.map((url, index) => {
    const image = task?.resultVideos?.[index] ?? task?.resultImages?.[index]
    const asset = resultAssetForTask(task, index, resultAssets ?? {})
    const src = asset && !asset.missing ? asset.url : url
    return { id: `${task?.id}:${index}`, mediaType: imageToVideo ? 'video' as const : 'image' as const,
      posterKey: task?.resultVideos?.[index]?.posterKey, retentionExpiresAt: task?.resultVideos?.[index]?.retentionExpiresAt,
      thumbSrc: imageToVideo ? '' : src, fullSrc: src,
      ...(imageToVideo && task?.params && 'durationSeconds' in task.params ? { durationLabel: t('panel.durationSeconds', { count: task.params.durationSeconds }) } : {}), originalSrc: imageToVideo || sourceAsset.missing ? undefined : sourceAsset.url, objectKey: asset?.objectKey ?? asset?.storage?.objectKey ?? image?.objectKey, ownerId: currentWorkstationHistoryOwner(), expiresAt: asset?.accessExpiresAt ?? image?.expiresAt, title: imageToVideo ? t('derived.videoResultTitle', { index: (image?.ordinal ?? index) + 1 }) : t('derived.variationResultTitle', { index: (image?.ordinal ?? index) + 1 }) }
  })
  const model = matchImageModel(models, modelProfileId)
  const originalModelId = task ? modelProfileIdForRetry(task) : undefined
  const originalModel = task ? matchImageModel(models, originalModelId) : model
  const originalResolution = task && 'resolution' in task.params ? task.params.resolution : resolution
  const retryCredits = task ? imageCreditAmount(originalModel, task.params.count, (originalResolution ?? resolution) as '1k' | '2k' | '4k') : estimatedCredits
  const retryVideoDuration = task && 'durationSeconds' in task.params ? task.params.durationSeconds : durationSeconds
  const retryVideoModel = task ? videoModels?.find(model => model.id === originalModelId) ?? (originalModelId === videoModel?.id ? videoModel : undefined) : videoModel
  const legacySilentH3 = imageToVideo && task && retryVideoModel?.audioMode === 'native' && (!('generateAudio' in task.params) || task.params.generateAudio !== true)
  const retryVideoCredits = videoCreditsForDuration(task && !videoRetryParametersSupported(retryVideoModel, 'image_to_video', task.params) ? undefined : retryVideoModel,
    retryVideoDuration, task ? originalResolution as VideoResolution : videoResolution)
  const videoCreditSubmitBlocked = imageToVideo && videoCreditBlocksSubmit({ mockGateway, loading: modelsLoading, credits: estimatedCredits, balance })
  const videoRetryBlocked = imageToVideo && videoCreditBlocksSubmit({ mockGateway, loading: modelsLoading, credits: retryVideoCredits, balance })
  const videoState = mockGateway ? 'ready' : videoAvailability ?? (modelsLoading ? 'loading' : videoConfigured ? 'ready' : 'soon')
  const showForm = !imageToVideo || videoState === 'ready'
  const quote = creditQuote(estimatedCredits, { mock: mockGateway, loading: modelsLoading })
  const retryQuote = creditQuote(imageToVideo ? retryVideoCredits : retryCredits, { mock: mockGateway, loading: modelsLoading })
  const advancedSummary = imageToVideo
    ? `${videoModel?.label ?? t('video.settings.defaultModelName')} · ${videoResolution ?? videoModel?.resolution ?? '720p'}`
    : `${model?.label ?? t('panel.defaultImageModelName')} · ${resolution.toUpperCase()}`
  const imageCreditBlocked = !imageToVideo && imageCreditBlocksSubmit({ mock: mockGateway, quote, balance: knownBalance })
  const imageRetryBlocked = !imageToVideo && imageCreditBlocksSubmit({ mock: mockGateway, quote: retryQuote, balance: knownBalance })

  return (
    <aside className="free-canvas-generation-panel free-canvas-derived-panel">
      <div className="free-canvas-panel-body">
      <div className="free-canvas-derived-header">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          disabled={active || formLocked}
          onClick={onBack}
          aria-label={t('derived.backAria')}
        />
        <div>
          <h2>{title}</h2>
          {showForm && <p>{imageToVideo ? t('derived.imageToVideoSubtitle') : t('derived.variationSubtitle')}</p>}
        </div>
      </div>

      <div className="free-canvas-source-card">
        {sourceAsset.missing ? <Spin /> : <img src={sourceAsset.url} alt={sourceAsset.name} />}
        <div>
          <strong>{sourceAsset.name}</strong>
          <span>{sourceAsset.width} × {sourceAsset.height}</span>
        </div>
      </div>

      {imageToVideo && showForm && <p className="free-canvas-field-hint">
        {t('derived.imageToVideoRule', {
          width: Math.round(sourceAsset.width),
          height: Math.round(sourceAsset.height),
          faceNote: videoModel?.provider === 'seedance' ? t('derived.seedanceFaceNote') : '',
        })}
      </p>}

      {!showForm ? <VideoAvailabilityNotice state={videoState} onRetry={onReloadModels} /> : <>
      <label className="free-canvas-field">
        <span>{imageToVideo ? t('derived.motionPromptLabel') : t('derived.variationPromptLabel')}</span>
        <Input.TextArea
          data-canvas-prompt
          rows={5}
          maxLength={imageToVideo ? VIDEO_PROMPT_MAX : VARIATION_USER_PROMPT_MAX}
          showCount
          value={prompt}
          disabled={formLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={imageToVideo
            ? t('derived.motionPromptPlaceholder')
            : t('derived.variationPromptPlaceholder')}
        />
      </label>

      {imageToVideo ? (
        <label className="free-canvas-field">
          <span>{t('panel.videoDurationLabel')}</span>
          <Radio.Group
            buttonStyle="solid"
            value={durationSeconds}
            disabled={formLocked}
            onChange={(event) => onDurationChange(Number(event.target.value))}
          >
            {[5, 10].map((value) => <Radio.Button key={value} value={value}>{t('panel.durationSeconds', { count: value })}</Radio.Button>)}
          </Radio.Group>
        </label>
      ) : (
        <label className="free-canvas-field">
          <span>{t('panel.countLabel')}</span>
          <GenerationCountPicker value={count} max={model?.ui.maxCount ?? 4} disabled={formLocked} onChange={onCountChange} />
        </label>
      )}

      <details className="free-canvas-advanced">
        <summary>
          <span className="free-canvas-advanced-title">{t('panel.advancedTitle')}</span>
          <span className="free-canvas-advanced-value">{advancedSummary}</span>
        </summary>
        <div className="free-canvas-advanced-fields">
          {!imageToVideo && <>
            <ModelChoice className="free-canvas-field" label={t('panel.modelLabel')} ariaLabel={t('derived.variationModelAria')} hintScope="single_image" models={models} value={model?.id} disabled={formLocked} onChange={onModelChange} />
            <label className="free-canvas-field"><span>{t('panel.resolutionLabel')}</span><Radio.Group aria-label={t('derived.variationResolutionAria')} value={resolution} disabled={formLocked} onChange={event => onResolutionChange?.(event.target.value)}>
              {(model?.ui.resolutions ?? ['1k', '2k', '4k']).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
            </Radio.Group></label>
          </>}
          {imageToVideo && <>
            <VideoGenerationSettings generateAudio={generateAudio} onAudioChange={onAudioChange} disabled={formLocked}
              loading={modelsLoading} configured={videoConfigured || mockGateway} mode="image_to_video"
              model={videoModel} models={videoModels} selectedId={selectedVideoModelId} resolution={videoResolution}
              onModelChange={onVideoModelChange} onResolutionChange={onVideoResolutionChange} />
            <VideoCreditEstimate credits={estimatedCredits} mockGateway={mockGateway} loading={modelsLoading} />
          </>}
        </div>
      </details>

      {!imageToVideo && <>
        {resolutionAdjusted && <p role="status">{t('derived.resolutionAdjusted', { resolution: resolution.toUpperCase() })}</p>}
        {modelsLoading
          ? <p role="status">{t('derived.loadingModels')}</p>
          : <p>{mockGateway ? t('video.credits.mock') : estimatedCredits === undefined ? t('derived.quoteUnavailableReload') : t('panel.estimatedCredits', { credits: estimatedCredits })}</p>}
      </>}
      {modelsLoading || imageToVideo ? null : generateDisabled ? (
        <p className="toolbox-hint">{t('derived.variationUnavailable')}</p>
      ) : null}
      {preparationPhase && <p role="status">{preparationPhase}</p>}
      </>}
      {(task?.status === 'failed' || task?.status === 'cancelled') && showForm && <CreditQuoteNotice quote={retryQuote} onRetry={onReloadModels} />}
      <GenerationTaskStatus
        task={task}
        submitting={submitting}
        active={active}
        polling={polling}
        summary={summary}
        submissionError={submissionError}
        protocolError={protocolError}
        pollError={pollError}
        historyError={historyError}
        historySaved={historySaved}
        onRetrySave={onRetrySave}
        onRetry={imageToVideo && videoState !== 'ready' ? undefined : onRetry}
        retryDisabled={imageToVideo ? videoState !== 'ready' || generateDisabled || videoRetryBlocked : modelsLoading || generateDisabled || imageRetryBlocked}
        retryQuote={retryQuote}
        retryLabel={!imageToVideo && !mockGateway ? t('panel.retryCountLabel', { count: task?.params.count ?? count }) : undefined}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />
      {!imageToVideo && !mockGateway && (task?.status === 'failed' || task?.status === 'cancelled') && <p>
        {t('panel.retryNotice', {
          count: task.params.count,
          quotePart: retryCredits === undefined ? t('panel.retryQuoteUnavailable') : t('panel.retryQuoteEstimated', { credits: retryCredits }),
        })}
      </p>}
      {imageToVideo && !mockGateway && task?.status === 'failed' && <p>{legacySilentH3 ? t('panel.videoRetryLegacySilentH3') : retryVideoCredits === undefined ? t('panel.videoRetryQuoteMissing') : t('panel.videoRetryReserveNotice', { credits: retryVideoCredits })}</p>}

      {task?.status === 'succeeded' && <PreviewResultStrip items={previewItems} onDownload={item => {
        const index = Number(item.id.slice(item.id.lastIndexOf(':') + 1))
        const image = task.resultImages?.[index]
        return downloadImageSource(item.fullSrc, `${t('derived.downloadFilenamePrefix')}_${(image?.ordinal ?? index) + 1}.${extensionForMime(image?.mimeType)}`, item.objectKey ?? image?.objectKey)
      }} />}

      {showForm && <p className="free-canvas-panel-hint">{t('derived.footerHint')}</p>}
      </div>
      {showForm && <div className="free-canvas-panel-footer">
        <CreditQuoteNotice quote={quote} onRetry={onReloadModels} />
        <Tooltip title={imageCreditBlocked ? insufficientCreditsReason() : undefined}>
          <span style={{ display: 'block' }}>
            <CreditActionButton data-task-generate
              className="free-canvas-generate"
              type="primary"
              block
              loading={submitting || autoRetrying}
              quote={quote}
              disabled={formLocked || generateDisabled || imageCreditBlocked || videoCreditSubmitBlocked || (imageToVideo && (modelsLoading || (!videoConfigured && !mockGateway) || !prompt.trim() || prompt.trim().length > VIDEO_PROMPT_MAX))}
              onClick={onGenerate}
            >
              {active ? t('panel.generatingButton') : imageToVideo ? t('panel.generateVideoButton') : t('panel.generateImagesButton', { count })}
            </CreditActionButton>
          </span>
        </Tooltip>
        <CreditSettlementHint quote={quote} />
        {!imageToVideo && <CreditBalanceNotice quote={quote} />}
      </div>}
    </aside>
  )
}
