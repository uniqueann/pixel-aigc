import { Alert, Button, Spin } from 'antd'
import type { GenerationTask } from '@/types'

const STATUS_LABELS = {
  pending: '准备中',
  queued: '排队中',
  processing: '生成中',
  succeeded: '生成完成',
  failed: '生成失败',
  cancelled: '任务已取消',
}

interface GenerationTaskStatusProps {
  task?: GenerationTask<unknown>
  submitting?: boolean
  active?: boolean
  polling?: boolean
  summary?: string
  submissionError?: string
  protocolError?: string
  pollError?: Error | null
  onRetry?: () => void
  onModifyParameters?: () => void
  onRefetch?: () => void
}

/** 跨业务复用的异步生成任务状态与恢复操作。 */
export default function GenerationTaskStatus({
  task,
  submitting = false,
  active = false,
  polling = false,
  summary,
  submissionError,
  protocolError,
  pollError,
  onRetry,
  onModifyParameters,
  onRefetch,
}: GenerationTaskStatusProps) {
  const terminalFailure = task?.status === 'failed' || task?.status === 'cancelled'

  return (
    <div className="generation-task-status-stack">
      {(task || submitting) ? (
        <div className={`generation-task-status is-${task?.status ?? 'pending'}`}>
          <div className="generation-task-status-title">
            <strong>{task ? STATUS_LABELS[task.status] : '正在提交'}</strong>
            {(active || polling) ? <Spin size="small" /> : null}
          </div>
          {summary ? <span>{summary}</span> : null}
          {terminalFailure && (onRetry || onModifyParameters) ? (
            <div className="generation-task-status-actions">
              {onRetry ? <Button size="small" type="primary" onClick={onRetry}>按原参数重试</Button> : null}
              {onModifyParameters ? <Button size="small" onClick={onModifyParameters}>修改参数</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {submissionError ? <Alert type="error" showIcon message="提交失败" description={submissionError} /> : null}
      {protocolError ? <Alert type="error" showIcon message="结果异常" description={protocolError} /> : null}
      {pollError ? (
        <Alert
          type="warning"
          showIcon
          message="任务状态查询失败"
          description="任务仍然保留，可以重新查询同一任务。"
          action={onRefetch ? <Button size="small" onClick={onRefetch}>重新查询</Button> : undefined}
        />
      ) : null}
    </div>
  )
}
