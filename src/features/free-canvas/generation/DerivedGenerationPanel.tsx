import { ArrowLeftOutlined } from '@ant-design/icons'
import { Button, Input, Radio } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import type { ImageAsset } from '@/editor/types'
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
  onRetry: () => void
  onModifyParameters: () => void
  onRefetch: () => void
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
  onRetry,
  onModifyParameters,
  onRefetch,
}: DerivedGenerationPanelProps) {
  const imageToVideo = mode === 'image-to-video'
  const title = imageToVideo ? '从图片生成视频' : '图片裂变'
  const summary = autoRetrying
    ? '首次生成失败，正在自动重试（1/1）'
    : task?.status === 'succeeded'
      ? imageToVideo
        ? '视频已生成并加入画布'
        : `已生成 ${task.resultUrls?.length ?? 0} 张裂变图片`
      : task?.status === 'failed' || task?.status === 'cancelled'
        ? task.errorMessage || '任务没有完成，请重试'
        : imageToVideo
          ? `本次生成 1 段 ${durationSeconds} 秒视频`
          : `本次生成 ${count} 张裂变图片`

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
        <img src={sourceAsset.url} alt={sourceAsset.name} />
        <div>
          <strong>{sourceAsset.name}</strong>
          <span>{sourceAsset.width} × {sourceAsset.height}</span>
        </div>
      </div>

      <label className="free-canvas-field">
        <span>{imageToVideo ? '动态描述' : '变化描述（可选）'}</span>
        <Input.TextArea
          rows={5}
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
            {[1, 2, 3, 4].map((value) => <Radio.Button key={value} value={value}>{value}</Radio.Button>)}
          </Radio.Group>
        </label>
      )}

      <Button
        type="primary"
        block
        loading={submitting || autoRetrying}
        disabled={formLocked || (imageToVideo && !prompt.trim())}
        onClick={onGenerate}
      >
        {active ? '正在生成' : imageToVideo ? '生成视频' : '开始裂变'}
      </Button>

      <GenerationTaskStatus
        task={task}
        submitting={submitting}
        active={active}
        polling={polling}
        summary={summary}
        submissionError={submissionError}
        protocolError={protocolError}
        pollError={pollError}
        onRetry={onRetry}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />

      <p className="free-canvas-panel-hint">结果会放在源图右侧；生成后仍可继续作为新的派生起点。</p>
    </aside>
  )
}
