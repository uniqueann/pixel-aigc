import { Button, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import type { FusionInputStage, FusionPreparationState } from '@/features/image-workstation/fusionInputs'
import CreditActionButton from '@/features/credits/CreditActionButton'
import type { CreditQuote } from '@/features/credits/quotes'

const STAGE_KEYS = {
  reading: 'fusion.stages.preparing',
  validating: 'fusion.stages.preparing',
  signing: 'fusion.stages.signing',
  uploading: 'fusion.stages.uploading',
  ready: 'fusion.stages.ready',
  failed: 'fusion.stages.failed',
  cancelled: 'fusion.stages.cancelled',
} as const satisfies Record<FusionInputStage, string>

export default function FusionInputStatus({ state, onRetry, onCancel, onModify, retryQuote }: {
  state?: FusionPreparationState
  onRetry: () => void
  onCancel: () => void
  onModify: () => void
  retryQuote?: CreditQuote
}) {
  const { t } = useTranslation(['workstation', 'common'])
  if (!state || state.phase === 'submitted') return null
  const phaseLabel = state.phase === 'submitting'
    ? t('fusion.phases.submitting')
    : state.phase === 'cancelled'
      ? t('fusion.phases.cancelled')
      : t('fusion.phases.preparing')

  return <div className={`generation-task-status is-${state.phase}`} aria-live="polite">
    <strong>{phaseLabel}</strong>
    {(['product', 'reference'] as const).map(role => {
      const status = state[role]
      const busy = !['ready', 'failed', 'cancelled'].includes(status.stage)
      const slot = t(role === 'product' ? 'fusion.productSlot' : 'fusion.referenceSlot')
      return <div key={role} className="fusion-input-status-row" data-role={role} data-stage={status.stage}>
        <span>{t('fusion.slotStatusLine', { slot, stage: t(STAGE_KEYS[status.stage]) })}</span>
        {busy ? <Spin size="small" /> : null}
        {status.error ? <span className="fusion-input-status-error">{status.error}</span> : null}
      </div>
    })}
    {state.phase === 'preparing' || state.phase === 'failed' ? <div className="generation-task-status-actions">
      {state.product.stage === 'failed' || state.reference.stage === 'failed' ? <CreditActionButton size="small" type="primary" quote={retryQuote} disabled={state.phase !== 'failed'} onClick={onRetry}>{t('fusion.retryFailedAndSubmit')}</CreditActionButton> : null}
      {state.phase === 'preparing' ? <Button size="small" onClick={onCancel}>{t('fusion.cancelPreparation')}</Button> : <Button size="small" onClick={onModify}>{t('common:taskStatus.modifyParameters')}</Button>}
    </div> : null}
  </div>
}
