import { describe, expect, it } from 'vitest'
import type { TaskOrigin } from '../../shared/task-center.js'
import { suiteTaskOriginMatches, type SuiteTaskIdentity } from './task-origin.js'

const expected: SuiteTaskIdentity = {
  requestId: '11111111-1111-4111-8111-111111111111',
  projectId: '22222222-2222-4222-8222-222222222222',
  slotId: '33333333-3333-4333-8333-333333333333',
  batchId: '44444444-4444-4444-8444-444444444444',
  operationId: '55555555-5555-4555-8555-555555555555',
}
const suiteOrigin: Extract<TaskOrigin, { entry: 'ecommerce' }> = {
  entry: 'ecommerce', tool: 'ecommerce-suite',
  projectId: expected.projectId, slotId: expected.slotId, batchId: expected.batchId, operationId: expected.operationId,
}
const job = (overrides: Partial<{ request_id: string; capability: string; origin: TaskOrigin | null }> = {}) => ({
  request_id: expected.requestId, capability: 'image_edit', origin: suiteOrigin, ...overrides,
})

describe('套图原任务来源校验', () => {
  it('只有套图创建且项目、槽位、批次、操作完全一致的任务才能绑定', () => {
    expect(suiteTaskOriginMatches(job(), expected)).toBe(true)
  })

  it('普通工作站任务即使复用了同一 requestId 也不能绑定', () => {
    expect(suiteTaskOriginMatches(job({ origin: { entry: 'workstation', tool: 'smart-edit' } }), expected)).toBe(false)
    expect(suiteTaskOriginMatches(job({ origin: null }), expected)).toBe(false)
  })

  it('套图来源但批次、槽位或操作不一致时拒绝绑定', () => {
    expect(suiteTaskOriginMatches(job({ origin: { ...suiteOrigin, operationId: '66666666-6666-4666-8666-666666666666' } }), expected)).toBe(false)
    expect(suiteTaskOriginMatches(job({ origin: { ...suiteOrigin, batchId: '66666666-6666-4666-8666-666666666666' } }), expected)).toBe(false)
    expect(suiteTaskOriginMatches(job({ origin: { ...suiteOrigin, slotId: '66666666-6666-4666-8666-666666666666' } }), expected)).toBe(false)
    expect(suiteTaskOriginMatches(job({ origin: { ...suiteOrigin, projectId: '66666666-6666-4666-8666-666666666666' } }), expected)).toBe(false)
  })

  it('requestId 或能力不一致时拒绝绑定', () => {
    expect(suiteTaskOriginMatches(job({ request_id: '66666666-6666-4666-8666-666666666666' }), expected)).toBe(false)
    expect(suiteTaskOriginMatches(job({ capability: 'text_to_image' }), expected)).toBe(false)
  })
})
