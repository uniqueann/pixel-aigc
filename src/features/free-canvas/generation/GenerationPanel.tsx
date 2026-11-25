import { useTranslation } from 'react-i18next'
import { Input, Radio, Segmented, Switch, Tooltip } from 'antd'
import ModelChoice from '@/components/ModelChoice'
import GenerationCountPicker from '@/components/GenerationCountPicker'
import { matchImageModel } from '@shared/image-models'
import { PROMPT_MAX_LENGTH, VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewResultStrip from '@/components/PreviewResultStrip'
import { downloadImageSource, extensionForMime } from '@/features/image-workstation/download'
import { translateApiError } from '@/i18n/apiErrors'
import { Capability, type GenerationTask } from '@/types'
import type { Asset } from '@/editor/types'
import type { PublicImageModel } from '@/services/api/imageModels'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useUserStore } from '@/store/useUserStore'
import type { CanvasGenerationTaskParams } from './requestBuilder'
import AspectRatioIcon from '@/components/AspectRatioIcon'
import { IMAGE_SIZE_PRESETS, getAspectRatioTooltip } from './config'
import { availableTextToImagePresets } from './textToImageParameters'
import { resultAssetForTask } from './resultAsset'
import VideoCreditEstimate from './VideoCreditEstimate'
import VideoGenerationSettings from './VideoGenerationSettings'
import { videoCreditBlocksSubmit, videoCreditsForDuration } from './videoCredits'
import type { VideoModelProfile, VideoRatio, VideoResolution } from '@shared/video-models'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { creditQuote, imageCreditAmount } from '@/features/credits/quotes'
import { insufficientCreditsReason, imageCreditBlocksSubmit } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { modelProfileIdForRetry } from './retryModel'
import { videoRetryParametersSupported } from './videoParameters'
import type { CapabilityAvailability } from '@/components/capabilityAvailability'
import VideoAvailabilityNotice from './VideoAvailabilityNotice'
import { taskFailureText } from '@/features/generation/providerErrorCopy'

interface GenerationPanelProps {
  mode: string
  prompt: string
  presetKey: string
  count: number
  durationSeconds: number
  generateAudio?: boolean
  onAudioChange?: (value: boolean) => void
  videoConfigured?: boolean
  videoModel?: VideoModelProfile
  videoModels?: VideoModelProfile[]
  selectedVideoModelId?: string
  videoResolution?: VideoResolution
  onVideoModelChange?: (id: string) => void
  onVideoResolutionChange?: (resolution: VideoResolution) => void
  videoAvailability?: CapabilityAvailability
  onReloadModels?: () => void
  task?: GenerationTask<CanvasGenerationTaskParams>
  submitting: boolean
  active: boolean
  formLocked: boolean
  polling: boolean
  submissionError?: string
  protocolError?: string
  pollError?: Error | null
  onPromptChange: (prompt: string) => void
  onPresetChange: (presetKey: string) => void
  onCountChange: (count: number) => void
  onDurationChange: (durationSeconds: number) => void
  onGenerate: () => void
  onRetry: () => void
  onModifyParameters: () => void
  onRefetch: () => void
  models?: PublicImageModel[]
  modelProfileId?: string
  resolution?: '1k' | '2k' | '4k'
  onModelChange?: (modelProfileId: string) => void
  onResolutionChange?: (resolution: '1k' | '2k' | '4k') => void
  enableThinking?: boolean
  onThinkingChange?: (value: boolean) => void
  estimatedCredits?: number
  resolutionAdjusted?: boolean
  ratioAdjusted?: boolean
  countAdjusted?: boolean
  modelsLoading?: boolean
  generateDisabled?: boolean
  mockGateway?: boolean
  historyError?: string
  historySaved?: boolean
  onRetrySave?: () => void
  resultAssets?: Record<string, Asset>
}

export default function GenerationPanel({
  mode,
  prompt,
  presetKey,
  count,
  durationSeconds,
  task,
  submitting,
  active,
  formLocked,
  polling,
  submissionError,
  protocolError,
  pollError,
  onPromptChange,
  onPresetChange,
  onCountChange,
  onDurationChange,
  onGenerate,
  onRetry,
  onModifyParameters,
  onRefetch,
  models = [], modelProfileId, resolution = '2k', onModelChange, onResolutionChange,
  enableThinking = false, onThinkingChange,
  estimatedCredits, resolutionAdjusted = false, ratioAdjusted = false, countAdjusted = false,
  modelsLoading = false, generateDisabled = false, mockGateway = true,
  historyError, historySaved, onRetrySave, resultAssets,
  generateAudio = false, onAudioChange, videoConfigured = false, videoModel,
  videoModels, selectedVideoModelId, videoResolution, onVideoModelChange, onVideoResolutionChange,
  videoAvailability, onReloadModels,
}: GenerationPanelProps) {
  const { t } = useTranslation('canvas')
  const textToVideo = mode === 'text-to-video'
  const balance = useUserStore(state => state.credits)
  const knownBalance = useKnownCreditBalance()
  const model = matchImageModel(models, modelProfileId)
  const supportedPresets = availableTextToImagePresets(model)
  const taskIsVideo = task?.capability === Capability.TextToVideo
  const taskDuration = task?.params && 'durationSeconds' in task.params
    ? task.params.durationSeconds
    : durationSeconds
  const taskFailureSummary = task?.status === 'failed' || task?.status === 'cancelled'
    ? translateApiError({
      code: task.errorCode,
      message: taskFailureText(task.errorCode, task.errorMessage, t('panel.taskIncompleteFallback')),
      fallback: t('panel.taskIncompleteFallback'),
    })
    : undefined
  const taskSummary = task?.status === 'succeeded'
    ? taskIsVideo
      ? t('panel.videoAddedSummary')
      : t('panel.imageSucceededSummary', {
        succeeded: task.resultImages?.length ?? task.resultUrls?.length ?? 0,
        total: task.params.count,
        costSuffix: mockGateway ? '' : t('panel.actualCostSuffix', { credits: task.creditsCost }),
      })
    : taskFailureSummary
      ?? (taskIsVideo || textToVideo
        ? t('panel.currentVideoCount', { duration: taskDuration })
        : t('panel.currentImageCount', { count: task?.params.count ?? count }))
  const resultUrls = task?.resultVideos?.length ? task.resultVideos.map(video => video.url) : task?.resultImages?.length ? task.resultImages.map(image => image.url) : task?.resultUrls ?? []
  const previewItems = resultUrls.map((url, index) => {
    const image = task?.resultVideos?.[index] ?? task?.resultImages?.[index]
    const asset = resultAssetForTask(task, index, resultAssets ?? {})
    const src = asset && !asset.missing ? asset.url : url
    return { id: `${task?.id}:${index}`, mediaType: taskIsVideo ? 'video' as const : 'image' as const,
      posterKey: task?.resultVideos?.[index]?.posterKey, retentionExpiresAt: task?.resultVideos?.[index]?.retentionExpiresAt,
      thumbSrc: taskIsVideo ? '' : src, fullSrc: src,
      ...(taskIsVideo && task?.params && 'durationSeconds' in task.params ? { durationLabel: t('panel.durationSeconds', { count: task.params.durationSeconds }) } : {}), title: t('panel.resultTitle', { index: (image?.ordinal ?? index) + 1 }), objectKey: asset?.objectKey ?? asset?.storage?.objectKey ?? image?.objectKey, ownerId: currentWorkstationHistoryOwner(), expiresAt: asset?.accessExpiresAt ?? image?.expiresAt }
  })
  const originalModelId = task ? modelProfileIdForRetry(task) : undefined
  const originalModel = task ? matchImageModel(models, originalModelId) : model
  const imagePromptMax = model?.ui.promptMaxLength ?? PROMPT_MAX_LENGTH
  const originalResolution = task && 'resolution' in task.params ? task.params.resolution : resolution
  const retryCredits = taskIsVideo ? undefined : task ? imageCreditAmount(originalModel, task.params.count, originalResolution as '1k' | '2k' | '4k' ?? resolution) : estimatedCredits
  const retryVideoModel = task ? videoModels?.find(item => item.id === originalModelId) ?? (originalModelId === videoModel?.id ? videoModel : undefined) : videoModel
  const retryVideoMode = task && 'mode' in task.params && task.params.mode === 'image_to_video' ? 'image_to_video' : 'text_to_video'
  const legacySilentH3 = taskIsVideo && retryVideoModel?.audioMode === 'native' && (!('generateAudio' in task.params) || task.params.generateAudio !== true)
  const retryVideoCredits = videoCreditsForDuration(taskIsVideo && !videoRetryParametersSupported(retryVideoModel, retryVideoMode, task.params) ? undefined : retryVideoModel, taskDuration,
    taskIsVideo ? originalResolution as VideoResolution : videoResolution)
  const videoCreditSubmitBlocked = textToVideo && videoCreditBlocksSubmit({ mockGateway, loading: modelsLoading, credits: estimatedCredits, balance })
  const videoRetryBlocked = taskIsVideo && videoCreditBlocksSubmit({ mockGateway, loading: modelsLoading, credits: retryVideoCredits, balance })
  const videoState = mockGateway ? 'ready' : videoAvailability ?? (modelsLoading ? 'loading' : videoConfigured ? 'ready' : 'soon')
  const showForm = !textToVideo || videoState === 'ready'
  const quote = creditQuote(estimatedCredits, { mock: mockGateway, loading: modelsLoading })
  const retryQuote = creditQuote(taskIsVideo ? retryVideoCredits : retryCredits, { mock: mockGateway, loading: modelsLoading })
  const activePreset = IMAGE_SIZE_PRESETS.find((preset) => preset.key === presetKey) ?? IMAGE_SIZE_PRESETS[0]
  const advancedSummary = textToVideo
    ? `${videoModel?.label ?? t('video.settings.defaultModelName')} · ${videoResolution ?? videoModel?.resolution ?? '720p'}`
    : `${model?.label ?? t('panel.defaultImageModelName')} · ${resolution.toUpperCase()}`
  const imageCreditBlocked = !textToVideo && imageCreditBlocksSubmit({ mock: mockGateway, quote, balance: knownBalance })
  const imageRetryBlocked = !taskIsVideo && imageCreditBlocksSubmit({ mock: mockGateway, quote: retryQuote, balance: knownBalance })

  return (
    <aside className="free-canvas-generation-panel">
      <div className="free-canvas-panel-body">
      <div>
        <h2>{textToVideo ? t('panel.textToVideoTitle') : t('panel.textToImageTitle')}</h2>
        {showForm && <p>{textToVideo ? t('panel.textToVideoDescription') : t('panel.textToImageDescription')}</p>}
      </div>
      {!showForm ? <VideoAvailabilityNotice state={videoState} onRetry={onReloadModels} /> : <>
      <label className="free-canvas-field">
        <span>{t('panel.promptLabel')}</span>
        <Input.TextArea
          data-canvas-prompt
          rows={6}
          value={prompt}
          maxLength={textToVideo ? VIDEO_PROMPT_MAX : imagePromptMax}
          showCount
          disabled={formLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={t('panel.promptPlaceholder')}
        />
      </label>

      <label className="free-canvas-field">
        <span>{t('panel.ratioLabel')}</span>
        <Segmented
          block
          className="free-canvas-aspect-ratio-segmented"
          options={IMAGE_SIZE_PRESETS.map((preset) => {
            // 视频也要按模型能力过滤比例（现在两个模型都全支持，但接口里 ratios 是可变的）。
            const isSupported = textToVideo
              ? !videoModel?.ratios?.length || videoModel.ratios.includes(preset.key as VideoRatio)
              : supportedPresets.some(item => item.key === preset.key)
            const baseTooltip = preset.tooltip ?? getAspectRatioTooltip(preset.key)
            const tooltipTitle = isSupported ? baseTooltip : t('panel.unsupportedRatioSuffix', { tooltip: baseTooltip })
            return {
              value: preset.key,
              disabled: !isSupported,
              title: '',
              label: (
                <Tooltip title={tooltipTitle} mouseEnterDelay={0.25}>
                  <span className="free-canvas-aspect-ratio-option">
                    <AspectRatioIcon ratio={preset.key} />
                    <span className="free-canvas-aspect-ratio-label">{preset.label}</span>
                  </span>
                </Tooltip>
              ),
            }
          })}
          value={presetKey}
          disabled={formLocked}
          onChange={(value) => onPresetChange(String(value))}
        />
        {/* 图标只是辅助，把当前比例的含义与像素直接写出来，不用悬停也读得懂。 */}
        <p className="free-canvas-field-hint">{t('panel.ratioHint', { tooltip: activePreset.tooltip ?? getAspectRatioTooltip(activePreset.key), width: activePreset.width, height: activePreset.height })}</p>
      </label>

      {textToVideo ? (
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
          {!textToVideo && <>
            <ModelChoice className="free-canvas-field" label={t('panel.modelLabel')} ariaLabel={t('panel.textToImageModelAria')} hintScope="text_to_image" models={models} value={model?.id} disabled={formLocked || modelsLoading} onChange={onModelChange} />
            <label className="free-canvas-field"><span>{t('panel.resolutionLabel')}</span><Radio.Group aria-label={t('panel.textToImageResolutionAria')} value={resolution} disabled={formLocked} onChange={event => onResolutionChange?.(event.target.value)}>
              {(model?.ui.resolutions ?? ['1k', '2k', '4k']).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
            </Radio.Group></label>
            {model?.provider === 'bailian' && <>
              <label className="free-canvas-field free-canvas-switch-field">
                <span>{t('panel.autoExpandLabel')}</span>
                <Switch aria-label={t('panel.autoExpandLabel')} checked={enableThinking} disabled={formLocked} onChange={onThinkingChange} />
              </label>
              <p>{t('panel.autoExpandHint')}</p>
            </>}
          </>}
          {textToVideo && <VideoGenerationSettings generateAudio={generateAudio} onAudioChange={onAudioChange} disabled={formLocked}
            loading={modelsLoading} configured={videoConfigured || mockGateway} model={videoModel} models={videoModels}
            resolution={videoResolution} selectedId={selectedVideoModelId} onModelChange={onVideoModelChange} onResolutionChange={onVideoResolutionChange} />}
          {textToVideo && <VideoCreditEstimate credits={estimatedCredits} mockGateway={mockGateway} loading={modelsLoading} />}
        </div>
      </details>

      {!textToVideo && <>
        {resolutionAdjusted && <p role="status">{t('panel.resolutionAdjusted', { resolution: resolution.toUpperCase() })}</p>}
        {ratioAdjusted && <p role="status">{t('panel.ratioAdjusted', { ratio: presetKey })}</p>}
        {countAdjusted && <p role="status">{t('panel.countAdjusted', { count })}</p>}
        {modelsLoading ? <p role="status">{t('panel.loadingTextToImageModels')}</p>
          : <p>{mockGateway ? t('video.credits.mock') : estimatedCredits === undefined
            ? t('panel.quoteUnavailableReload')
            : t('panel.estimatedCredits', { credits: estimatedCredits })}</p>}
        {!modelsLoading && generateDisabled && <p className="toolbox-hint">{t('panel.textToImageUnavailable')}</p>}
      </>}

      </>}
      {(task?.status === 'failed' || task?.status === 'cancelled') && (!taskIsVideo || showForm) && <CreditQuoteNotice quote={retryQuote} onRetry={onReloadModels} />}
      <GenerationTaskStatus
        task={task}
        submitting={submitting}
        active={active}
        polling={polling}
        summary={taskSummary}
        submissionError={submissionError}
        protocolError={protocolError}
        pollError={pollError}
        historyError={historyError}
        historySaved={historySaved}
        onRetrySave={onRetrySave}
        onRetry={taskIsVideo && videoState !== 'ready' ? undefined : onRetry}
        retryDisabled={taskIsVideo ? videoState !== 'ready' || generateDisabled || videoRetryBlocked : modelsLoading || generateDisabled || imageRetryBlocked}
        retryQuote={retryQuote}
        retryLabel={!taskIsVideo && !textToVideo && !mockGateway ? t('panel.retryCountLabel', { count: task?.params.count ?? count }) : undefined}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />
      {!taskIsVideo && !textToVideo && !mockGateway && (task?.status === 'failed' || task?.status === 'cancelled') && <p>
        {t('panel.retryNotice', {
          count: task.params.count,
          quotePart: retryCredits === undefined ? t('panel.retryQuoteUnavailable') : t('panel.retryQuoteEstimated', { credits: retryCredits }),
        })}
      </p>}
      {taskIsVideo && !mockGateway && task?.status === 'failed' && <p>{legacySilentH3 ? t('panel.videoRetryLegacySilentH3') : retryVideoCredits === undefined ? t('panel.videoRetryQuoteMissing') : t('panel.videoRetryReserveNotice', { credits: retryVideoCredits })}</p>}

      {task?.status === 'succeeded' && <PreviewResultStrip items={previewItems} onDownload={item => {
        const index = Number(item.id.slice(item.id.lastIndexOf(':') + 1))
        const image = task.resultImages?.[index]
        return downloadImageSource(item.fullSrc, `${t('panel.downloadFilenamePrefix')}_${(image?.ordinal ?? index) + 1}.${extensionForMime(image?.mimeType)}`, item.objectKey ?? image?.objectKey)
      }} />}

      {showForm && <p className="free-canvas-panel-hint">{t('panel.footerHint')}</p>}
      </div>
      {showForm && <div className="free-canvas-panel-footer">
        <CreditQuoteNotice quote={quote} onRetry={onReloadModels} />
        <Tooltip title={imageCreditBlocked ? insufficientCreditsReason() : undefined}>
          <span style={{ display: 'block' }}>
            <CreditActionButton data-task-generate
              className="free-canvas-generate"
              type="primary"
              block
              loading={submitting}
              quote={quote}
              disabled={formLocked || generateDisabled || imageCreditBlocked || videoCreditSubmitBlocked || (textToVideo && (modelsLoading || (!videoConfigured && !mockGateway) || prompt.trim().length > VIDEO_PROMPT_MAX)) || (!textToVideo && (modelsLoading || prompt.trim().length > imagePromptMax)) || !prompt.trim()}
              onClick={onGenerate}
            >
              {active ? t('panel.generatingButton') : textToVideo ? t('panel.generateVideoButton') : t('panel.generateImagesButton', { count })}
            </CreditActionButton>
          </span>
        </Tooltip>
        <CreditSettlementHint quote={quote} />
        {!textToVideo && <CreditBalanceNotice quote={quote} />}
      </div>}
    </aside>
  )
}
