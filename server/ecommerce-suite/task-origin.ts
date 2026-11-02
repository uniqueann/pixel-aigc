import type { TaskOrigin } from '../../shared/task-center.js'

export interface SuiteTaskIdentity {
  requestId: string
  projectId: string
  slotId: string
  batchId: string
  operationId: string
}

/**
 * 只有套图自己创建、且项目／槽位／批次／操作全部一致的 image_edit 任务才能被绑定。
 * 仅按 requestId 查找会让用户用普通任务抢占套图派发，从而跳过报价预扣并伪造版本来源。
 */
export function suiteTaskOriginMatches(
  job: { request_id: string; capability: string; origin?: TaskOrigin | null },
  expected: SuiteTaskIdentity,
) {
  const origin = job.origin
  return job.request_id === expected.requestId && job.capability === 'image_edit'
    && origin?.entry === 'ecommerce' && origin.tool === 'ecommerce-suite'
    && origin.projectId === expected.projectId && origin.slotId === expected.slotId
    && origin.batchId === expected.batchId && origin.operationId === expected.operationId
}
