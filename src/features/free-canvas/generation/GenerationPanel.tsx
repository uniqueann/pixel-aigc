import { Button, Input, Radio, Segmented, Select } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import PreviewResultStrip from '@/components/PreviewResultStrip'
import { downloadImageSource, extensionForMime } from '@/features/image-workstation/download'
import { Capability, type GenerationTask } from '@/types'
import type { Asset } from '@/editor/types'
import type { PublicImageModel } from '@/services/api/imageModels'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import type { CanvasGenerationTaskParams } from './requestBuilder'
import { IMAGE_SIZE_PRESETS } from './config'
import { availableTextToImagePresets } from './textToImageParameters'
import { resultAssetForTask } from './resultAsset'

interface GenerationPanelProps {
  mode: string
  prompt: string
  presetKey: string
  count: number
  durationSeconds: number
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
  estimatedCredits, resolutionAdjusted = false, ratioAdjusted = false, countAdjusted = false,
  modelsLoading = false, generateDisabled = false, mockGateway = true,
  historyError, historySaved, onRetrySave, resultAssets,
}: GenerationPanelProps) {
  const textToVideo = mode === 'text-to-video'
  const model = models.find(item => item.id === modelProfileId)
  const supportedPresets = availableTextToImagePresets(model)
  const taskIsVideo = task?.capability === Capability.TextToVideo
  const taskDuration = task?.params && 'durationSeconds' in task.params
    ? task.params.durationSeconds
    : durationSeconds
  const taskSummary = task?.status === 'succeeded'
    ? taskIsVideo
      ? '视频已生成并加入画布'
      : `成功 ${task.resultImages?.length ?? task.resultUrls?.length ?? 0} / ${task.params.count} 张图片${mockGateway ? '' : `，实际消耗 ${task.creditsCost} 积分`}`
    : task?.status === 'failed' || task?.status === 'cancelled'
      ? task.errorMessage || '任务没有完成，请重试'
      : taskIsVideo || textToVideo
        ? `本次生成 1 段 ${taskDuration} 秒视频`
        : `本次生成 ${task?.params.count ?? count} 张图片`
  const resultUrls = task?.resultImages?.length ? task.resultImages.map(image => image.url) : task?.resultUrls ?? []
  const previewItems = resultUrls.map((url, index) => {
    const image = task?.resultImages?.[index]
    const asset = resultAssetForTask(task, index, resultAssets ?? {})
    const src = asset && !asset.missing ? asset.url : url
    return { id: `${task?.id}:${index}`, thumbSrc: src, fullSrc: src, title: `生成结果 ${(image?.ordinal ?? index) + 1}`, objectKey: asset?.objectKey ?? asset?.storage?.objectKey ?? image?.objectKey, ownerId: currentWorkstationHistoryOwner(), expiresAt: asset?.accessExpiresAt ?? image?.expiresAt }
  })
  const originalModel = task?.modelProfileId ? models.find(item => item.id === task.modelProfileId) : model
  const originalResolution = task && 'resolution' in task.params ? task.params.resolution : resolution
  const retryUnitPrice = originalModel?.pricing.creditsPerImage[originalResolution ?? resolution]
  const retryCredits = task ? retryUnitPrice === undefined ? undefined : task.params.count * retryUnitPrice : estimatedCredits

  return (
    <aside className="free-canvas-generation-panel">
      <div>
        <h2>{textToVideo ? '文生视频' : '文生图'}</h2>
        <p>{textToVideo ? '描述镜头内容，生成结果会作为可播放视频加入画布。' : '输入创意描述，结果会直接加入当前视口中心。'}</p>
      </div>

      <label className="free-canvas-field">
        <span>画面描述</span>
        <Input.TextArea
          rows={6}
          value={prompt}
          maxLength={textToVideo ? undefined : model?.ui.promptMaxLength}
          showCount={!textToVideo && !!model?.ui.promptMaxLength}
          disabled={formLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="例如：雨夜里的未来城市，霓虹灯倒映在街道上"
        />
      </label>

      <label className="free-canvas-field">
        <span>画面比例</span>
        <Segmented
          block
          options={IMAGE_SIZE_PRESETS.map((preset) => ({ label: preset.label, value: preset.key, disabled: !textToVideo && !supportedPresets.some(item => item.key === preset.key) }))}
          value={presetKey}
          disabled={formLocked}
          onChange={(value) => onPresetChange(String(value))}
        />
      </label>

      {textToVideo ? (
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

      {!textToVideo && <>
        <label className="free-canvas-field"><span>生成模型</span><Select aria-label="文生图模型" value={modelProfileId} options={models.map(item => ({ label: item.label, value: item.id }))} disabled={formLocked || modelsLoading} onChange={onModelChange} /></label>
        <label className="free-canvas-field"><span>分辨率</span><Radio.Group aria-label="文生图分辨率" value={resolution} disabled={formLocked} onChange={event => onResolutionChange?.(event.target.value)}>
          {(model?.ui.resolutions ?? ['1k', '2k', '4k']).map(value => <Radio.Button key={value} value={value}>{value.toUpperCase()}</Radio.Button>)}
        </Radio.Group></label>
        {resolutionAdjusted && <p role="status">当前模型或画面比例不支持所选分辨率，已按 {resolution.toUpperCase()} 计算本次参数与积分。</p>}
        {ratioAdjusted && <p role="status">当前模型不支持所选比例，已按 {presetKey} 计算本次参数。</p>}
        {countAdjusted && <p role="status">当前模型最多支持本次数量，已按 {count} 张计算本次参数与积分。</p>}
        {modelsLoading ? <p role="status">正在加载文生图模型配置…</p>
          : <p>{mockGateway ? '模拟生成，不消耗积分' : estimatedCredits === undefined
            ? '模型积分报价尚未就绪，请重新读取文生图配置。'
            : `本次预计预扣 ${estimatedCredits} 积分，按实际成功张数结算。失败后由你决定是否再次生成。`}</p>}
        {!modelsLoading && generateDisabled && <p className="toolbox-hint">文生图模型尚未就绪，请检查登录与模型配置。</p>}
      </>}
      {textToVideo && !mockGateway && <p className="toolbox-hint">视频真实生成尚未接入，目前仅支持模拟模式。</p>}

      <Button
        type="primary"
        block
        loading={submitting}
        disabled={formLocked || generateDisabled || (!textToVideo && (modelsLoading || (!!model?.ui.promptMaxLength && prompt.trim().length > model.ui.promptMaxLength))) || !prompt.trim()}
        onClick={onGenerate}
      >
        {active ? '正在生成' : textToVideo ? '生成视频到画布' : '生成到画布'}
      </Button>
      {!taskIsVideo && !textToVideo && !mockGateway && (task?.status === 'failed' || task?.status === 'cancelled') && <p>
        手动重试将按原参数创建新任务，生成 {task.params.count} 张，{retryCredits === undefined ? '原模型积分报价尚未就绪，请先确认模型配置。' : `预计预扣 ${retryCredits} 积分。`}
      </p>}

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
        onRetry={onRetry}
        retryLabel={!taskIsVideo && !textToVideo && !mockGateway ? `按原参数重试 ${task?.params.count ?? count} 张` : undefined}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />
      {task?.status === 'succeeded' && !taskIsVideo && <PreviewResultStrip items={previewItems} onDownload={item => {
        const index = Number(item.id.slice(item.id.lastIndexOf(':') + 1))
        const image = task.resultImages?.[index]
        return downloadImageSource(item.fullSrc, `生成结果_${(image?.ordinal ?? index) + 1}.${extensionForMime(image?.mimeType)}`, item.objectKey ?? image?.objectKey)
      }} />}

      <p className="free-canvas-panel-hint">生成期间可移动占位位置；完成后，{textToVideo ? '视频' : '图片'}会保留该位置和尺寸。</p>
    </aside>
  )
}
