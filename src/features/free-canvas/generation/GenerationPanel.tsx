import { Button, Input, Radio, Segmented } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import { Capability, type GenerationTask } from '@/types'
import type { CanvasGenerationTaskParams } from './requestBuilder'
import { IMAGE_SIZE_PRESETS } from './config'

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
}: GenerationPanelProps) {
  const textToVideo = mode === 'text-to-video'
  const taskIsVideo = task?.capability === Capability.TextToVideo
  const taskDuration = task?.params && 'durationSeconds' in task.params
    ? task.params.durationSeconds
    : durationSeconds
  const taskSummary = task?.status === 'succeeded'
    ? taskIsVideo
      ? '视频已生成并加入画布'
      : `已生成 ${task.resultUrls?.length ?? 0} 张图片`
    : task?.status === 'failed' || task?.status === 'cancelled'
      ? task.errorMessage || '任务没有完成，请重试'
      : taskIsVideo || textToVideo
        ? `本次生成 1 段 ${taskDuration} 秒视频`
        : `本次生成 ${task?.params.count ?? count} 张图片`

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
          disabled={formLocked}
          onChange={(event) => onPromptChange(event.target.value)}
          placeholder="例如：雨夜里的未来城市，霓虹灯倒映在街道上"
        />
      </label>

      <label className="free-canvas-field">
        <span>画面比例</span>
        <Segmented
          block
          options={IMAGE_SIZE_PRESETS.map((preset) => ({ label: preset.label, value: preset.key }))}
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
            {[1, 2, 3, 4].map((value) => <Radio.Button key={value} value={value}>{value}</Radio.Button>)}
          </Radio.Group>
        </label>
      )}

      <Button
        type="primary"
        block
        loading={submitting}
        disabled={formLocked || !prompt.trim()}
        onClick={onGenerate}
      >
        {active ? '正在生成' : textToVideo ? '生成视频到画布' : '生成到画布'}
      </Button>

      <GenerationTaskStatus
        task={task}
        submitting={submitting}
        active={active}
        polling={polling}
        summary={taskSummary}
        submissionError={submissionError}
        protocolError={protocolError}
        pollError={pollError}
        onRetry={onRetry}
        onModifyParameters={onModifyParameters}
        onRefetch={onRefetch}
      />

      <p className="free-canvas-panel-hint">生成期间可移动占位位置；完成后，{textToVideo ? '视频' : '图片'}会保留该位置和尺寸。</p>
    </aside>
  )
}
