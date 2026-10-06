import { Button, Spin } from 'antd'
import type { FusionInputStage, FusionPreparationState } from '@/features/image-workstation/fusionInputs'
import CreditActionButton from '@/features/credits/CreditActionButton'
import type { CreditQuote } from '@/features/credits/quotes'

const LABELS: Record<FusionInputStage, string> = {
  reading: '正在准备图片', validating: '正在准备图片', signing: '正在准备上传', uploading: '正在上传',
  ready: '图片已就绪', failed: '图片准备失败', cancelled: '已取消',
}
export default function FusionInputStatus({ state, onRetry, onCancel, onModify, retryQuote }: {
  state?: FusionPreparationState
  onRetry: () => void
  onCancel: () => void
  onModify: () => void
  retryQuote?: CreditQuote
}) {
  if (!state || state.phase === 'submitted') return null
  return <div className={`generation-task-status is-${state.phase}`} aria-live="polite">
    <strong>{state.phase === 'submitting' ? '正在提交融合任务' : state.phase === 'cancelled' ? '输入准备已取消' : '融合图片准备'}</strong>
    {(['product', 'reference'] as const).map(role => {
      const status = state[role]
      const busy = !['ready', 'failed', 'cancelled'].includes(status.stage)
      return <div key={role} className="fusion-input-status-row" data-role={role} data-stage={status.stage}>
        <span>{role === 'product' ? '商品图' : '场景图'}：{LABELS[status.stage]}</span>
        {busy ? <Spin size="small" /> : null}
        {status.error ? <span className="fusion-input-status-error">{status.error}</span> : null}
      </div>
    })}
    {state.phase === 'preparing' || state.phase === 'failed' ? <div className="generation-task-status-actions">
      {state.product.stage === 'failed' || state.reference.stage === 'failed' ? <CreditActionButton size="small" type="primary" quote={retryQuote} disabled={state.phase !== 'failed'} onClick={onRetry}>重试失败图片并提交</CreditActionButton> : null}
      {state.phase === 'preparing' ? <Button size="small" onClick={onCancel}>取消准备</Button> : <Button size="small" onClick={onModify}>修改参数</Button>}
    </div> : null}
  </div>
}
