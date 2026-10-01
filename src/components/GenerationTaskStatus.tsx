import { Alert, Button, Spin } from 'antd'
import type { GenerationTask } from '@/types'

const WARNING_LABELS: Record<string, string> = {
  RESOLUTION_DOWNGRADED_4K_UNSUPPORTED_RATIO: '当前比例不支持 4K，已按 2K 生成',
  PARTIAL: '部分图片生成成功',
  LATE_RESULT_NO_CHARGE: '结果在超时后送达，未计入消耗',
}

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
  readingResults?: boolean
  resultReadError?: string
  historyError?: string
  historySaved?: boolean
  onRetryRead?: () => void
  onRetrySave?: () => void
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
  readingResults = false,
  resultReadError,
  historyError,
  historySaved = false,
  onRetryRead,
  onRetrySave,
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
            <strong>{readingResults ? '读取结果中' : task ? STATUS_LABELS[task.status] : '正在提交'}</strong>
            {(active || polling || readingResults) ? <Spin size="small" /> : null}
          </div>
          {summary ? <span>{summary}</span> : null}
          {task?.warnings?.length ? (
            <span>{task.warnings.map(code => WARNING_LABELS[code] ?? code).join('；')}</span>
          ) : null}
          {terminalFailure && (onRetry || onModifyParameters) ? (
            <div className="generation-task-status-actions">
              {onRetry ? <Button size="small" type="primary" onClick={onRetry}>按原参数重试</Button> : null}
              {onModifyParameters ? <Button size="small" onClick={onModifyParameters}>修改参数</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {task?.status === 'succeeded' && historySaved ? <span>完整图片已保存到本地历史</span> : null}
      {resultReadError ? <Alert type="warning" showIcon message="已生成，结果读取失败" description={resultReadError} action={onRetryRead ? <Button size="small" loading={readingResults} onClick={onRetryRead}>重试读取</Button> : undefined} /> : null}
      {historyError ? <Alert type="warning" showIcon message="图片可用，历史未保存" description={historyError} action={onRetrySave ? <Button size="small" onClick={onRetrySave}>重试保存</Button> : undefined} /> : null}
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
