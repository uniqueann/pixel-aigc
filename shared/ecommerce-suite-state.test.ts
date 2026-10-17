import { describe, expect, it } from 'vitest'
import { suiteBatchProgress, suiteOperationRetryable } from './ecommerce-suite-state'
import type { SuiteOperation } from './ecommerce-suite'

const op = (value: Partial<SuiteOperation> = {}): SuiteOperation => ({
  id: crypto.randomUUID(), actor: { userId: crypto.randomUUID(), runtimeScope: 'local' }, projectId: crypto.randomUUID(),
  batchId: crypto.randomUUID(), slotId: crypto.randomUUID(), requestId: crypto.randomUUID(), mode: 'image_edit',
  phase: 'waiting', expectedHeadRevision: 0, task: null, terminalState: null, appliedVersionIds: [],
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...value,
})
describe('批次按槽位派生状态与手动重试范围', () => {
  it('七槽位混合活动和失败时仍为运行中，四个候选只计一个完成槽位', () => {
    const operations = [op({ terminalState: 'succeeded', phase: 'bound', appliedVersionIds: Array.from({ length: 4 }, () => crypto.randomUUID()) }),
      op({ phase: 'bound', task: { sourceKind: 'image_job', sourceId: crypto.randomUUID(), requestId: crypto.randomUUID() } }),
      op({ terminalState: 'failed', phase: 'bound' }), ...Array.from({ length: 4 }, () => op())]
    expect(suiteBatchProgress(operations)).toMatchObject({ state: 'running', completed: 1, total: 7, terminal: false })
    operations[1] = op({ terminalState: 'failed', phase: 'bound' })
    for (let i = 3; i < 7; i++) operations[i] = op({ phase: 'stopped' })
    expect(suiteBatchProgress(operations)).toMatchObject({ state: 'partial', completed: 1, terminal: true })
  })
  it('阻塞保留活动名额和原因，全部停止才映射取消', () => {
    expect(suiteBatchProgress([op({ phase: 'blocked', errorCode: 'INSUFFICIENT_CREDITS' })])).toMatchObject({ state: 'blocked', blockedReason: 'INSUFFICIENT_CREDITS' })
    expect(suiteBatchProgress([op({ phase: 'stopped' }), op({ phase: 'stopped' })])).toMatchObject({ state: 'stopped', terminal: true })
  })
  it('确认中、成功候选和活动原任务不可重试；明确失败或未执行可重新确认', () => {
    for (const value of [op({ phase: 'confirming' }), op({ phase: 'bound' }), op({ terminalState: 'failed', appliedVersionIds: [crypto.randomUUID()] })])
      expect(suiteOperationRetryable(value)).toBe(false)
    for (const value of [op({ phase: 'stopped' }), op({ phase: 'blocked' }), op({ terminalState: 'failed' })])
      expect(suiteOperationRetryable(value)).toBe(true)
  })
})
