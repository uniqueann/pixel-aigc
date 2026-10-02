import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Input, Radio, Select, Spin } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewResultStrip from '@/components/PreviewResultStrip'
import { downloadImageSource, extensionForMime } from '@/features/image-workstation/download'
import type { Asset, ImageAsset } from '@/editor/types'
import type { PublicImageModel } from '@/services/api/imageModels'
import { VARIATION_USER_PROMPT_MAX } from '@shared/variation'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import type { GenerationTask } from '@/types'
import type { CanvasGenerationTaskParams } from './requestBuilder'

export type DerivedGenerationMode = 'variation' | 'image-to-video'

interface DerivedGenerationPanelProps {
  mode: DerivedGenerationMode
  sourceAsset: ImageAsset
  prompt: string
  count: number
  durationSeconds: number
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
}: DerivedGenerationPanelProps) {
  const imageToVideo = mode === 'image-to-video'
  const title = imageToVideo ? '从图片生成视频' : '图片裂变'
  const summary = autoRetrying
    ? '首次生成失败，正在自动重试（1/1）'
    : task?.status === 'succeeded'
      ? imageToVideo
        ? '视频已生成并加入画布'
        : `成功 ${task.resultImages?.length ?? task.resultUrls?.length ?? 0} / ${task.params.count} 张裂变图片${mockGateway ? '' : `，实际消耗 ${task.creditsCost} 积分`}`
      : task?.status === 'failed' || task?.status === 'cancelled'
        ? task.errorMessage || '任务没有完成，请重试'
        : imageToVideo
          ? `本次生成 1 段 ${durationSeconds} 秒视频`
          : `本次生成 ${count} 张裂变图片`
  const resultUrls = task?.resultImages?.length ? task.resultImages.map(image => image.url) : task?.resultUrls ?? []
  const previewItems = resultUrls.map((url, index) => {
    const image = task?.resultImages?.[index]
    const asset = image?.objectKey ? Object.values(resultAssets ?? {}).find(item => item.objectKey === image.objectKey) : undefined
    const src = asset && !asset.missing ? asset.url : url
    return { id: `${task?.id}:${index}`, thumbSrc: src, fullSrc: src, originalSrc: sourceAsset.missing ? undefined : sourceAsset.url, objectKey: image?.objectKey, ownerId: currentWorkstationHistoryOwner(), expiresAt: image?.expiresAt, title: `裂变结果 ${(image?.ordinal ?? index) + 1}` }
  })
  const model = models.find(item => item.id === modelProfileId)
  const originalModel = models.find(item => item.id === task?.modelProfileId) ?? model
  const originalResolution = task && 'resolution' in task.params ? task.params.resolution : resolution
  const retryCredits = task ? task.params.count * (originalModel?.pricing?.creditsPerImage[originalResolution ?? resolution] ?? 0) : estimatedCredits

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
          <p>{imageToVideo ? '让选中的图片按描述动起来。' : '基于选中的图片探索更多视觉方案。'}</p>
        </div>
      </div>

      <div className="free-canvas-source-card">
        {sourceAsset.missing ? <Spin /> : <img src={sourceAsset.url} alt={sourceAsset.name} />}
        <div>
          <strong>{sourceAsset.name}</strong>
          <span>{sourceAsset.width} × {sourceAsset.height}</span>
        </div>
      </div>

      <label className="free-canvas-field">
        <span>{imageToVideo ? '动态描述' : '变化描述（可选）'}</span>
        <Input.TextArea
          rows={5}
          maxLength={imageToVideo ? undefined : VARIATION_USER_PROMPT_MAX}
          showCount={!imageToVideo}
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
          <Radio.Group
            buttonStyle="solid"
            value={count}
            disabled={formLocked}
            onChange={(event) => onCountChange(Number(event.target.value))}
          >
            {[1, 2, 3, 4].filter(value => value <= (model?.ui.maxCount ?? 4)).map((value) => <Radio.Button key={value} value={value}>{value}</Radio.Button>)}
          </Radio.Group>
        </label>
      )}

      {!imageToVideo && <>
        <label className="free-canvas-field"><span>生成模型</span><Select aria-label="裂变模型" value={modelProfileId} options={models.map(item => ({ label: item.label, value: item.id }))} disabled={formLocked} onChange={onModelChange} /></label>
        <label className="free-canvas-field"><span>分辨率</span><Radio.Group aria-label="裂变分辨率" value={resolution} disabled={formLocked} onChange={event => onResolutionChange?.(event.target.value)}>
          {(model?.ui.resolutions ?? ['1k', '2k', '4k']).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
        </Radio.Group></label>
        {resolutionAdjusted && <p role="status">当前模型或图片比例不支持所选分辨率，已按 {resolution.toUpperCase()} 计算本次参数与积分。</p>}
        {modelsLoading
          ? <p role="status">正在加载模型配置…</p>
          : <p>{mockGateway ? '模拟生成，不消耗积分' : `本次预计预扣 ${estimatedCredits ?? 0} 积分，按实际成功张数结算。失败后由你决定是否再次生成。`}</p>}
      </>}

      {modelsLoading || imageToVideo ? null : generateDisabled ? (
        <p className="toolbox-hint">裂变模型尚未就绪，请检查登录与模型配置。</p>
      ) : null}
      <Button
        type="primary"
        block
        loading={submitting || autoRetrying}
        disabled={formLocked || generateDisabled || (imageToVideo && !prompt.trim())}
        onClick={onGenerate}
      >
        {active ? '正在生成' : imageToVideo ? '生成视频' : `开始裂变 ${count} 张`}
      </Button>
      {preparationPhase && <p role="status">{preparationPhase}</p>}
      {!imageToVideo && !mockGateway && (task?.status === 'failed' || task?.status === 'cancelled') && <p>
        手动重试将按原参数创建新任务，生成 {task.params.count} 张，预计预扣 {retryCredits} 积分。
      </p>}

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
        onRetry={onRetry}
        retryLabel={!imageToVideo && !mockGateway ? `按原参数重试 ${task?.params.count ?? count} 张` : undefined}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />
      {task?.status === 'succeeded' && !imageToVideo && <PreviewResultStrip items={previewItems} onDownload={item => {
        const index = Number(item.id.slice(item.id.lastIndexOf(':') + 1))
        const image = task.resultImages?.[index]
        return downloadImageSource(item.fullSrc, `裂变结果_${(image?.ordinal ?? index) + 1}.${extensionForMime(image?.mimeType)}`, image?.objectKey)
      }} />}

      <p className="free-canvas-panel-hint">结果会落在画板内可见位置；生成后仍可继续作为新的派生起点。</p>
    </aside>
  )
}
