import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Radio, Spin, Tooltip } from 'antd'
import { CornerHintTextArea } from '@/components/CornerHintTextArea'
import ModelChoice from '@/components/ModelChoice'
import GenerationCountPicker from '@/components/GenerationCountPicker'
import { VIDEO_PROMPT_MAX } from '@shared/prompt-limits'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewResultStrip from '@/components/PreviewResultStrip'
import { downloadImageSource, extensionForMime } from '@/features/image-workstation/download'
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
import type { VideoModelProfile } from '@shared/video-models'
import CreditActionButton, { CreditBalanceNotice, CreditQuoteNotice, CreditSettlementHint } from '@/features/credits/CreditActionButton'
import { creditQuote, imageCreditAmount } from '@/features/credits/quotes'
import { INSUFFICIENT_CREDITS_REASON, imageCreditBlocksSubmit } from '@/features/credits/imageCredits'
import { useKnownCreditBalance } from '@/features/credits/useKnownCreditBalance'
import { modelProfileIdForRetry } from './retryModel'
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
  videoAvailability, onReloadModels,
}: DerivedGenerationPanelProps) {
  const imageToVideo = mode === 'image-to-video'
  const balance = useUserStore(state => state.credits)
  const knownBalance = useKnownCreditBalance()
  const title = imageToVideo ? '从图片生成视频' : '图片裂变'
  const summary = autoRetrying
    ? '首次生成失败，正在自动重试（1/1）'
    : task?.status === 'succeeded'
      ? imageToVideo
        ? '视频已生成并加入画布'
        : `成功 ${task.resultImages?.length ?? task.resultUrls?.length ?? 0} / ${task.params.count} 张裂变图片${mockGateway ? '' : `，实际消耗 ${task.creditsCost} 积分`}`
      : task?.status === 'failed' || task?.status === 'cancelled'
        ? taskFailureText(task.errorCode, task.errorMessage, '任务没有完成，请重试')
        : imageToVideo
          ? `本次生成 1 段 ${durationSeconds} 秒视频`
          : `本次生成 ${count} 张裂变图片`
  const resultUrls = task?.resultVideos?.length ? task.resultVideos.map(video => video.url) : task?.resultImages?.length ? task.resultImages.map(image => image.url) : task?.resultUrls ?? []
  const previewItems = resultUrls.map((url, index) => {
    const image = task?.resultVideos?.[index] ?? task?.resultImages?.[index]
    const asset = resultAssetForTask(task, index, resultAssets ?? {})
    const src = asset && !asset.missing ? asset.url : url
    return { id: `${task?.id}:${index}`, mediaType: imageToVideo ? 'video' as const : 'image' as const,
      posterKey: task?.resultVideos?.[index]?.posterKey, retentionExpiresAt: task?.resultVideos?.[index]?.retentionExpiresAt,
      thumbSrc: imageToVideo ? '' : src, fullSrc: src, originalSrc: imageToVideo || sourceAsset.missing ? undefined : sourceAsset.url, objectKey: asset?.objectKey ?? asset?.storage?.objectKey ?? image?.objectKey, ownerId: currentWorkstationHistoryOwner(), expiresAt: asset?.accessExpiresAt ?? image?.expiresAt, title: `${imageToVideo ? '视频' : '裂变'}结果 ${(image?.ordinal ?? index) + 1}` }
  })
  const model = models.find(item => item.id === modelProfileId)
  const originalModelId = task ? modelProfileIdForRetry(task) : undefined
  const originalModel = task ? models.find(item => item.id === originalModelId) : model
  const originalResolution = task && 'resolution' in task.params ? task.params.resolution : resolution
  const retryCredits = task ? imageCreditAmount(originalModel, task.params.count, originalResolution ?? resolution) : estimatedCredits
  const retryVideoDuration = task && 'durationSeconds' in task.params ? task.params.durationSeconds : durationSeconds
  const retryVideoCredits = videoCreditsForDuration(task && originalModelId !== videoModel?.id ? undefined : videoModel, retryVideoDuration)
  const videoCreditSubmitBlocked = imageToVideo && videoCreditBlocksSubmit({ mockGateway, loading: modelsLoading, credits: estimatedCredits, balance })
  const videoRetryBlocked = imageToVideo && videoCreditBlocksSubmit({ mockGateway, loading: modelsLoading, credits: retryVideoCredits, balance })
  const videoState = mockGateway ? 'ready' : videoAvailability ?? (modelsLoading ? 'loading' : videoConfigured ? 'ready' : 'soon')
  const showForm = !imageToVideo || videoState === 'ready'
  const quote = creditQuote(estimatedCredits, { mock: mockGateway, loading: modelsLoading })
  const retryQuote = creditQuote(imageToVideo ? retryVideoCredits : retryCredits, { mock: mockGateway, loading: modelsLoading })
  const imageCreditBlocked = !imageToVideo && imageCreditBlocksSubmit({ mock: mockGateway, quote, balance: knownBalance })
  const imageRetryBlocked = !imageToVideo && imageCreditBlocksSubmit({ mock: mockGateway, quote: retryQuote, balance: knownBalance })

  return (
    <aside className="free-canvas-generation-panel free-canvas-derived-panel">
      <div className="free-canvas-derived-header">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          disabled={active || formLocked}
          onClick={onBack}
          aria-label="返回基础生成"
        />
        <div>
          <h2>{title}</h2>
          {showForm && <p>{imageToVideo ? '让选中的图片按描述动起来。' : '基于选中的图片探索更多视觉方案。'}</p>}
        </div>
      </div>

      <div className="free-canvas-source-card">
        {sourceAsset.missing ? <Spin /> : <img src={sourceAsset.url} alt={sourceAsset.name} />}
        <div>
          <strong>{sourceAsset.name}</strong>
          <span>{sourceAsset.width} × {sourceAsset.height}</span>
        </div>
      </div>

      {!showForm ? <VideoAvailabilityNotice state={videoState} onRetry={onReloadModels} /> : <>
      <label className="free-canvas-field">
        <span>{imageToVideo ? '动态描述' : '变化描述（可选）'}</span>
        <CornerHintTextArea
          rows={5}
          maxLength={imageToVideo ? VIDEO_PROMPT_MAX : VARIATION_USER_PROMPT_MAX}
          showCount
          value={prompt}
          disabled={formLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder={imageToVideo
            ? '例如：镜头缓慢推进，树叶随风摆动，阳光流过画面'
            : '例如：保持主体，尝试不同构图与光线'}
        />
      </label>

      {imageToVideo ? (
        <label className="free-canvas-field">
          <span>视频时长</span>
          <Radio.Group
            buttonStyle="solid"
            value={durationSeconds}
            disabled={formLocked}
            onChange={(event) => onDurationChange(Number(event.target.value))}
          >
            {[5, 10].map((value) => <Radio.Button key={value} value={value}>{value} 秒</Radio.Button>)}
          </Radio.Group>
        </label>
      ) : (
        <label className="free-canvas-field">
          <span>生成数量</span>
          <GenerationCountPicker value={count} max={model?.ui.maxCount ?? 4} disabled={formLocked} onChange={onCountChange} />
        </label>
      )}

      {!imageToVideo && <>
        <ModelChoice className="free-canvas-field" label="生成模型" ariaLabel="裂变模型" hintScope="single_image" models={models} value={modelProfileId} disabled={formLocked} onChange={onModelChange} />
        <label className="free-canvas-field"><span>分辨率</span><Radio.Group aria-label="裂变分辨率" value={resolution} disabled={formLocked} onChange={event => onResolutionChange?.(event.target.value)}>
          {(model?.ui.resolutions ?? ['1k', '2k', '4k']).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
        </Radio.Group></label>
        {resolutionAdjusted && <p role="status">当前模型或图片比例不支持所选分辨率，已按 {resolution.toUpperCase()} 计算本次参数与积分。</p>}
        {modelsLoading
          ? <p role="status">正在加载模型配置…</p>
          : <p>{mockGateway ? '模拟生成，不消耗积分' : estimatedCredits === undefined ? '模型积分报价尚未就绪，请重新加载。' : `本次预计预扣 ${estimatedCredits} 积分，按实际成功张数结算。失败后由你决定是否再次生成。`}</p>}
      </>}

      {modelsLoading || imageToVideo ? null : generateDisabled ? (
        <p className="toolbox-hint">裂变模型尚未就绪，请检查登录与模型配置。</p>
      ) : null}
      {imageToVideo && <><VideoGenerationSettings generateAudio={generateAudio} onAudioChange={onAudioChange} disabled={formLocked}
        loading={modelsLoading} configured={videoConfigured || mockGateway} />
        <p>保持原图比例；首期暂不支持含真人人脸的图片。</p>
        <VideoCreditEstimate credits={estimatedCredits} mockGateway={mockGateway} loading={modelsLoading} /></>}
      <CreditQuoteNotice quote={quote} onRetry={onReloadModels} />
      <Tooltip title={imageCreditBlocked ? INSUFFICIENT_CREDITS_REASON : undefined}>
        <span style={{ display: 'block' }}>
          <CreditActionButton
            className="free-canvas-generate"
            type="primary"
            block
            loading={submitting || autoRetrying}
            quote={quote}
            disabled={formLocked || generateDisabled || imageCreditBlocked || videoCreditSubmitBlocked || (imageToVideo && (modelsLoading || (!videoConfigured && !mockGateway) || !prompt.trim() || prompt.trim().length > VIDEO_PROMPT_MAX))}
            onClick={onGenerate}
          >
            {active ? '正在生成' : imageToVideo ? '生成' : `生成 ${count} 张`}
          </CreditActionButton>
        </span>
      </Tooltip>
      <CreditSettlementHint quote={quote} />
      {!imageToVideo && <CreditBalanceNotice quote={quote} />}
      {preparationPhase && <p role="status">{preparationPhase}</p>}
      {!imageToVideo && !mockGateway && (task?.status === 'failed' || task?.status === 'cancelled') && <p>
        手动重试将按原参数创建新任务，生成 {task.params.count} 张，{retryCredits === undefined ? '原模型报价暂不可用，请修改参数后重新生成。' : `预计预扣 ${retryCredits} 积分。`}
      </p>}
      {imageToVideo && !mockGateway && task?.status === 'failed' && <p>{retryVideoCredits === undefined ? '请先读取视频配置与报价，再决定是否重新生成。' : `重新生成将创建新任务并预扣 ${retryVideoCredits} 积分。`}</p>}
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
        retryLabel={!imageToVideo && !mockGateway ? `按原参数重试 ${task?.params.count ?? count} 张` : undefined}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />
      {task?.status === 'succeeded' && <PreviewResultStrip items={previewItems} onDownload={item => {
        const index = Number(item.id.slice(item.id.lastIndexOf(':') + 1))
        const image = task.resultImages?.[index]
        return downloadImageSource(item.fullSrc, `裂变结果_${(image?.ordinal ?? index) + 1}.${extensionForMime(image?.mimeType)}`, item.objectKey ?? image?.objectKey)
      }} />}

      {showForm && <p className="free-canvas-panel-hint">结果会落在画板内可见位置；生成后仍可继续作为新的派生起点。</p>}
    </aside>
  )
}
