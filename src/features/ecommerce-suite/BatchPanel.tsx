import { useState } from 'react'
import { Button, Checkbox, Popconfirm, Tag } from 'antd'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { suiteBatchProgress, suiteOperationErrorLabel, suiteOperationRetryable } from '@shared/ecommerce-suite-state'
import { taskBillingLabel } from '@shared/task-center'
import type { SuiteRetrySelection } from './BatchPlanPanel'

const phases = { waiting: '等待生成', dispatching: '生成中', confirming: '确认中', bound: '生成中', blocked: '待确认', stopped: '已停止' }
const states = { queued: '排队中', running: '生成中', blocked: '待处理', succeeded: '已完成', partial: '部分完成', failed: '失败', stopped: '已停止' }
export default function BatchPanel({ data, disabled, focusedBatchId, onStop, onRetry }: {
  data: SuiteProjectDetail; disabled: boolean; focusedBatchId?: string; onStop: (id: string) => void; onRetry: (selection: SuiteRetrySelection) => void
}) {
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const followed = new Set(data.operations.flatMap(op => op.retryOfOperationId ? [op.retryOfOperationId] : []))
  return <section className="suite-batches" aria-label="生成记录">
    <h3>生成记录</h3><p className="suite-muted">生成结果已保存为各槽位的备选版本，可切换上方对应槽位查看并选用。</p>
    {[...data.batches].sort((a, b) => a.id === focusedBatchId ? -1 : b.id === focusedBatchId ? 1 : Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 5).map(batch => {
      const operations = data.operations.filter(op => op.batchId === batch.id)
      const progress = suiteBatchProgress(operations)
      const closing = operations.some(op => op.task && !op.terminalState || op.phase === 'confirming')
      const retryIds = operations.filter(op => selected[op.id] && !followed.has(op.id) && suiteOperationRetryable(op)).map(op => op.slotId)
      return <div className="suite-batch" key={batch.id} id={`batch-${batch.id}`}>
        <strong>{states[batch.state]} · {progress.completed}/{progress.total} 个槽位已完成</strong>
        <small>{new Date(batch.createdAt).toLocaleString()} · 预估上限 {batch.maxCredits} 积分</small>
        {operations.map(operation => {
          const task = data.tasks.find(task => task.sourceId === operation.task?.sourceId)
          return <div className="suite-batch-operation" key={operation.id}>
            <Checkbox checked={Boolean(selected[operation.id])} disabled={disabled || closing || followed.has(operation.id) || !suiteOperationRetryable(operation)}
              onChange={event => setSelected(value => ({ ...value, [operation.id]: event.target.checked }))}>
              {data.project.config.slots.find(slot => slot.id === operation.slotId)?.name}
            </Checkbox>
            <Tag>{operation.terminalState ? operation.appliedVersionIds.length ? '已生成' : '未完成' : operation.phase === 'bound' && (operation.mode === 'reuse' || task && !['queued', 'processing'].includes(task.state)) ? '保存结果中' : phases[operation.phase]}</Tag>
            <span>{task ? taskBillingLabel(task) : operation.mode === 'reuse' ? '底图复用，无生成费用' : '尚未扣费'}</span>
            {operation.errorCode && <small>{suiteOperationErrorLabel(operation.errorCode)}</small>}
          </div>
        })}
        <div className="suite-actions">
          {['queued', 'running', 'blocked'].includes(batch.state) && <Popconfirm title="停止未开始生成的项？" description="正在生成的图片不受影响，未开始生成的项将取消。" onConfirm={() => onStop(batch.id)}>
            <Button size="small" disabled={disabled}>停止未开始项</Button>
          </Popconfirm>}
          <Button size="small" disabled={disabled || closing || !retryIds.length} onClick={() => onRetry({ batchId: batch.id, slotIds: retryIds })}>重新生成未完成项</Button>
        </div>
      </div>
    })}
    {!data.batches.length && <p className="suite-muted">暂无批量生成记录</p>}
  </section>
}
