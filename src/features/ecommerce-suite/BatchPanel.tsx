import { useState } from 'react'
import { Button, Checkbox, Popconfirm, Tag } from 'antd'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { suiteBatchProgress, suiteOperationErrorLabel, suiteOperationRetryable } from '@shared/ecommerce-suite-state'
import { taskBillingLabel } from '@shared/task-center'
import type { SuiteRetrySelection } from './BatchPlanPanel'

const phases = { waiting: '等待派发', dispatching: '派发中', confirming: '原提交确认中', bound: '原任务处理中', blocked: '等待重新确认', stopped: '未派发已停止' }
const states = { queued: '排队中', running: '处理中', blocked: '已阻塞', succeeded: '已完成', partial: '部分完成', failed: '失败', stopped: '已停止' }
export default function BatchPanel({ data, disabled, focusedBatchId, onStop, onRetry }: {
  data: SuiteProjectDetail; disabled: boolean; focusedBatchId?: string; onStop: (id: string) => void; onRetry: (selection: SuiteRetrySelection) => void
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const followed = new Set(data.operations.flatMap(op => op.retryOfOperationId ? [op.retryOfOperationId] : []))
  return <section className="suite-batches" aria-label="生成批次">
    <h3>生成批次</h3><p className="suite-muted">结果先保存为候选，请切换对应槽位，在版本页签中显式选用。</p>
    {[...data.batches].sort((a, b) => a.id === focusedBatchId ? -1 : b.id === focusedBatchId ? 1 : Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5).map(batch => {
      const operations = data.operations.filter(op => op.batchId === batch.id)
      const progress = suiteBatchProgress(operations)
      const closing = operations.some(op => op.task && !op.terminalState || op.phase === 'confirming')
      const retryIds = operations.filter(op => selected[op.id] && !followed.has(op.id) && suiteOperationRetryable(op)).map(op => op.slotId)
      return <div className="suite-batch" key={batch.id} id={`batch-${batch.id}`}>
        <strong>{states[batch.state]} · {progress.completed}/{progress.total} 个目标槽位有结果</strong>
        <small>批次 {batch.id} · 预算上限 {batch.maxCredits} 积分</small>
        {operations.map(operation => {
          const task = data.tasks.find(task => task.sourceId === operation.task?.sourceId)
          return <div className="suite-batch-operation" key={operation.id}>
            <Checkbox checked={Boolean(selected[operation.id])} disabled={disabled || closing || followed.has(operation.id) || !suiteOperationRetryable(operation)}
              onChange={event => setSelected(value => ({ ...value, [operation.id]: event.target.checked }))}>
              {data.project.config.slots.find(slot => slot.id === operation.slotId)?.name}
            </Checkbox>
            <Tag>{operation.terminalState ? operation.appliedVersionIds.length ? '候选已保存' : '本次未完成' : operation.phase === 'bound' && (operation.mode === 'reuse' || task && !['queued', 'processing'].includes(task.state)) ? '结果登记中' : phases[operation.phase]}</Tag>
            <span>{task ? taskBillingLabel(task) : operation.mode === 'reuse' ? '图片复用，无生成费用' : operation.task ? '账本暂不可查，费用未知' : '尚未创建原任务，未预扣'}</span>
            {operation.errorCode && <small>{suiteOperationErrorLabel(operation.errorCode)}</small>}
          </div>
        })}
        <div className="suite-actions">
          {['queued', 'running', 'blocked'].includes(batch.state) && <Popconfirm title="停止尚未创建原任务的项？" description="已提交原任务继续执行并按成功候选结算。" onConfirm={() => onStop(batch.id)}>
            <Button size="small" disabled={disabled}>停止未派发项</Button>
          </Popconfirm>}
          <Button size="small" disabled={disabled || closing || !retryIds.length} onClick={() => onRetry({ batchId: batch.id, slotIds: retryIds })}>重新确认所选未执行／失败项</Button>
        </div>
      </div>
    })}
    {!data.batches.length && <p className="suite-muted">尚未接受生成计划</p>}
  </section>
}
