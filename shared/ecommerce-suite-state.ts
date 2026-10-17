import type { SuiteBatch, SuiteOperation } from './ecommerce-suite.js'

export const suiteOperationFinished = (op: SuiteOperation) => op.phase === 'stopped' || Boolean(op.terminalState)
export const suiteOperationRetryable = (op: SuiteOperation) => !op.appliedVersionIds.length
  && (op.phase === 'stopped' || op.phase === 'blocked' && !op.task || Boolean(op.terminalState && op.terminalState !== 'succeeded'))

export function suiteOperationErrorLabel(code: string) {
  const labels: Record<string, string> = {
    USER_STOPPED: '用户已停止未派发项', PROJECT_DELETED: '项目已移入回收站', RECONFIRMED: '已通过新计划重新确认',
    DISPATCH_DEADLINE: '三十分钟派发窗口已结束', INSUFFICIENT_CREDITS: '积分余额不足，请补足后重新确认',
    SUITE_QUOTE_CHANGED: '模型、价格或规格已变化，请重新报价', SUITE_BUDGET_EXCEEDED: '本批次预算不足，请重新确认',
    RATE_LIMIT: '请求频率受限，等待首次派发', USER_CONCURRENCY: '等待当前图片任务完成',
    GLOBAL_CONCURRENCY: '服务繁忙，等待派发', MODEL_CONCURRENCY: '模型繁忙，等待派发',
    PROVIDER_CONCURRENCY: '图片服务繁忙，等待派发', SUITE_ASSET_UNAVAILABLE: '输入图片不可用，请补充后重新确认',
    IMAGE_EDIT_UNAVAILABLE: '所选图片服务暂不可用，请重新选择模型',
    BACKGROUND_SUBMIT_DISABLED: '后台首发已暂停，等待服务恢复',
  }
  return labels[code] ?? '本项暂未完成，请核对资料或服务状态后重新确认'
}

/** 批次按目标槽位计数；同一槽位的多个候选不扩大分母。 */
export function suiteBatchProgress(operations: SuiteOperation[]) {
  const completed = operations.filter(op => op.appliedVersionIds.length > 0).length
  const active = operations.some(op => !suiteOperationFinished(op) && (op.task || ['dispatching', 'confirming'].includes(op.phase)))
  const blocked = operations.find(op => op.phase === 'blocked')
  let state: SuiteBatch['state']
  if (active) state = blocked ? 'blocked' : 'running'
  else if (blocked) state = 'blocked'
  else if (operations.some(op => !suiteOperationFinished(op))) state = 'queued'
  else if (completed === operations.length) state = 'succeeded'
  else if (completed) state = 'partial'
  else state = operations.every(op => op.phase === 'stopped') ? 'stopped' : 'failed'
  return { state, completed, total: operations.length, terminal: ['succeeded', 'partial', 'failed', 'stopped'].includes(state),
    blockedReason: blocked?.errorCode ?? null }
}
