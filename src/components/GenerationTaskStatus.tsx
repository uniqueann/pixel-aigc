import { Alert, Button, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { GenerationTask } from '@/types'
import { Capability } from '@/types'
import CreditActionButton from '@/features/credits/CreditActionButton'
import type { CreditQuote } from '@/features/credits/quotes'

const WARNING_CODES = new Set([
  'RESOLUTION_DOWNGRADED_4K_UNSUPPORTED_RATIO',
  'PARTIAL',
  'LATE_RESULT_NO_CHARGE',
])

const PHASE_KEYS = new Set(['submitting', 'queued', 'generating', 'transferring'])

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
  /** 结果不可读时只抑制「生成完成」；结论与重试统一由页面页脚给出。 */
  resultUnavailable?: boolean
  historyError?: string
  historySaved?: boolean
  onRetrySave?: () => void
  onRetry?: () => void
  retryLabel?: string
  retryDisabled?: boolean
  retryQuote?: CreditQuote
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
  resultUnavailable = false,
  historyError,
  historySaved = false,
  onRetrySave,
  onRetry,
  retryLabel,
  retryDisabled = false,
  retryQuote,
  onModifyParameters,
  onRefetch,
}: GenerationTaskStatusProps) {
  const { t, i18n } = useTranslation('common')
  const terminalFailure = task?.status === 'failed' || task?.status === 'cancelled'
  const video = task?.capability === Capability.TextToVideo
  const phaseLabel = task?.phase && PHASE_KEYS.has(task.phase)
    ? t(`taskStatus.phases.${task.phase}` as never)
    : undefined
  const warningSeparator = i18n.language === 'en-US' ? '; ' : '；'

  return (
    <div className="generation-task-status-stack">
      {resultUnavailable ? null : (task || submitting) ? (
        <div className={`generation-task-status is-${task?.status ?? 'pending'}`} role="status" aria-live="polite">
          <div className="generation-task-status-title">
            <strong>{readingResults ? t('taskStatus.readingResults') : phaseLabel ?? (task ? t(`taskStatus.states.${task.status}` as never) : t('taskStatus.submitting'))}</strong>
            {(active || polling || readingResults) ? <Spin size="small" /> : null}
          </div>
          {summary ? <span>{summary}</span> : null}
          {task?.warnings?.length ? (
            <span>{task.warnings.map(code => WARNING_CODES.has(code) ? t(`taskStatus.warnings.${code}` as never) : code).join(warningSeparator)}</span>
          ) : null}
          {terminalFailure && (onRetry || onModifyParameters) ? (
            <div className="generation-task-status-actions">
              {onRetry ? <CreditActionButton size="small" type="primary" loading={submitting} disabled={retryDisabled} quote={retryQuote} onClick={onRetry}>{retryLabel ?? t('taskStatus.retryDefault')}</CreditActionButton> : null}
              {onModifyParameters ? <Button size="small" onClick={onModifyParameters}>{t('taskStatus.modifyParameters')}</Button> : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {!resultUnavailable && task?.status === 'succeeded' && historySaved ? <span>{video ? t('taskStatus.videoSaved') : t('taskStatus.imageSaved')}</span> : null}
      {historyError ? <Alert type="warning" showIcon message={video ? t('taskStatus.videoHistoryError') : t('taskStatus.imageHistoryError')} description={historyError} action={onRetrySave ? <Button size="small" onClick={onRetrySave}>{t('taskStatus.retrySave')}</Button> : undefined} /> : null}
      {submissionError ? <Alert type="error" showIcon message={t('taskStatus.submitFailed')} description={submissionError} /> : null}
      {protocolError ? <Alert type="error" showIcon message={t('taskStatus.protocolError')} description={protocolError} /> : null}
      {pollError ? (
        <Alert
          type="warning"
          showIcon
          message={t('taskStatus.pollErrorTitle')}
          description={t('taskStatus.pollErrorDescription')}
          action={onRefetch ? <Button size="small" onClick={onRefetch}>{t('actions.refetch')}</Button> : undefined}
        />
      ) : null}
    </div>
  )
}
