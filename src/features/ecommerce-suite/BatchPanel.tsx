import { useState } from 'react'
import { Button, Checkbox, Popconfirm, Tag } from 'antd'
import { useTranslation } from 'react-i18next'
import { formatDateTime, formatNumber } from '@/i18n/format'
import { localizedTaskBillingLabel } from '@/features/task-center/format'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { suiteBatchProgress, suiteOperationRetryable } from '@shared/ecommerce-suite-state'
import type { SuiteRetrySelection } from './BatchPlanPanel'
import { suiteOperationErrorText, suiteSlotLabel } from './i18n'

export default function BatchPanel({ data, disabled, focusedBatchId, onStop, onRetry }: {
  data: SuiteProjectDetail; disabled: boolean; focusedBatchId?: string; onStop: (id: string) => void; onRetry: (selection: SuiteRetrySelection) => void
}) {
  const { t } = useTranslation('ecommerce')
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const followed = new Set(data.operations.flatMap(op => op.retryOfOperationId ? [op.retryOfOperationId] : []))
  return <section className="suite-batches" aria-label={t('batches.heading')}>
    <h3>{t('batches.heading')}</h3><p className="suite-muted">{t('batches.subtitle')}</p>
    {[...data.batches].sort((a, b) => a.id === focusedBatchId ? -1 : b.id === focusedBatchId ? 1 : Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5).map(batch => {
      const operations = data.operations.filter(op => op.batchId === batch.id)
      const progress = suiteBatchProgress(operations)
      const closing = operations.some(op => op.task && !op.terminalState || op.phase === 'confirming')
      const retryIds = operations.filter(op => selected[op.id] && !followed.has(op.id) && suiteOperationRetryable(op)).map(op => op.slotId)
      return <div className="suite-batch" key={batch.id} id={`batch-${batch.id}`}>
        <strong>{t('batches.batchSummary', { state: t(`batches.states.${batch.state}`), completed: progress.completed, total: progress.total })}</strong>
        <small>{t('batches.batchMeta', { createdAt: formatDateTime(batch.createdAt), maxCredits: formatNumber(batch.maxCredits) })}</small>
        {operations.map(operation => {
          const task = data.tasks.find(task => task.sourceId === operation.task?.sourceId)
          const slot = data.project.config.slots.find(slot => slot.id === operation.slotId)
          return <div className="suite-batch-operation" key={operation.id}>
            <Checkbox checked={Boolean(selected[operation.id])} disabled={disabled || closing || followed.has(operation.id) || !suiteOperationRetryable(operation)}
              onChange={event => setSelected(value => ({ ...value, [operation.id]: event.target.checked }))}>
              {slot ? suiteSlotLabel(slot) : undefined}
            </Checkbox>
            <Tag>{operation.terminalState ? operation.appliedVersionIds.length ? t('batches.opTags.generated') : t('batches.opTags.incomplete') : operation.phase === 'bound' && (operation.mode === 'reuse' || task && !['queued', 'processing'].includes(task.state)) ? t('batches.opTags.savingResult') : t(`batches.phases.${operation.phase}`)}</Tag>
            <span>{task ? localizedTaskBillingLabel(task) : operation.mode === 'reuse' ? t('batches.reuseFree') : t('batches.notCharged')}</span>
            {operation.errorCode && <small>{suiteOperationErrorText(operation.errorCode)}</small>}
          </div>
        })}
        <div className="suite-actions">
          {['queued', 'running', 'blocked'].includes(batch.state) && <Popconfirm title={t('batches.stopConfirmTitle')} description={t('batches.stopConfirmDesc')} onConfirm={() => onStop(batch.id)}>
            <Button size="small" disabled={disabled}>{t('batches.stopButton')}</Button>
          </Popconfirm>}
          <Button size="small" disabled={disabled || closing || !retryIds.length} onClick={() => onRetry({ batchId: batch.id, slotIds: retryIds })}>{t('batches.retryButton')}</Button>
        </div>
      </div>
    })}
    {!data.batches.length && <p className="suite-muted">{t('batches.empty')}</p>}
  </section>
}
