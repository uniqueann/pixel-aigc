import { Button, Input, Radio, Segmented } from 'antd'
import GenerationTaskStatus from '@/components/GenerationTaskStatus'
import type { GenerationTask, TextToImageTaskParams } from '@/types'
import { IMAGE_SIZE_PRESETS } from './config'

interface GenerationPanelProps {
  mode: string
  prompt: string
  presetKey: string
  count: number
  task?: GenerationTask<TextToImageTaskParams>
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
  onGenerate,
  onRetry,
  onModifyParameters,
  onRefetch,
}: GenerationPanelProps) {
  const textToVideo = mode === 'text-to-video'
  const taskSummary = task?.status === 'succeeded'
    ? `已生成 ${task.resultUrls?.length ?? 0} 张图片`
    : task?.status === 'failed' || task?.status === 'cancelled'
      ? task.errorMessage || '任务没有完成，请重试'
      : `本次生成 ${task?.params.count ?? count} 张图片`

  return (
    <aside className="free-canvas-generation-panel">
      <div>
        <h2>{textToVideo ? '文生视频' : '文生图'}</h2>
        <p>{textToVideo ? '视频节点将在 Stage 4.3 接入。' : '输入创意描述，结果会直接加入当前视口中心。'}</p>
      </div>

      <label className="free-canvas-field">
        <span>画面描述</span>
        <Input.TextArea
          rows={6}
          value={prompt}
          disabled={textToVideo || formLocked}
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
          disabled={textToVideo || formLocked}
          onChange={(value) => onPresetChange(String(value))}
        />
      </label>

      <label className="free-canvas-field">
        <span>生成数量</span>
        <Radio.Group
          buttonStyle="solid"
          value={count}
          disabled={textToVideo || formLocked}
          onChange={(event) => onCountChange(Number(event.target.value))}
        >
          {[1, 2, 3, 4].map((value) => <Radio.Button key={value} value={value}>{value}</Radio.Button>)}
        </Radio.Group>
      </label>

      {!textToVideo && (
        <Button
          type="primary"
          block
          loading={submitting}
          disabled={formLocked || !prompt.trim()}
          onClick={onGenerate}
        >
          {active ? '正在生成' : '生成到画布'}
        </Button>
      )}
      {textToVideo && <Button type="primary" block disabled>Stage 4.3 接入</Button>}

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

      <p className="free-canvas-panel-hint">生成期间可移动占位位置；完成后，图片会保留该位置和尺寸。</p>
    </aside>
  )
}
