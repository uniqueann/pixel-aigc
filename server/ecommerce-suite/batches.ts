import type { Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { suiteBatchSchema, suiteOperationSchema, type SuiteOperation } from '../../shared/ecommerce-suite.js'
import { suiteBatchProgress } from '../../shared/ecommerce-suite-state.js'
import { requireSuite, suiteTransaction, type SuiteUser } from './repository.js'
import { runtimeScope } from '../db.js'
import { taskRepository } from '../task-center/repository.js'
import { queryPort } from '../task-center/service.js'

export async function writeSuiteOperation(sql: Transaction, operation: SuiteOperation) {
  const value = suiteOperationSchema.parse(operation)
  await sql`update aigc.suite_operations set snapshot=${sql.json(value as never)},source_job_id=${value.task?.sourceId ?? null} where id=${value.id}`
}

/** 调用者已按项目、批次顺序加锁；这里只派生读模型，不改原任务或账本。 */
export async function refreshSuiteBatch(sql: Transaction, batchId: string) {
  const [row] = await sql`select snapshot from aigc.suite_batches where id=${batchId} for update`
  if (!row) throw new HttpError(404, '批次不存在或无权访问', 'SUITE_NOT_FOUND')
  const batch = suiteBatchSchema.parse(row.snapshot)
  const operations = (await sql`select snapshot from aigc.suite_operations where batch_id=${batchId} order by id`).map(row => suiteOperationSchema.parse(row.snapshot))
  const progress = suiteBatchProgress(operations)
  const next = suiteBatchSchema.parse({ ...batch, state: progress.state, blockedReason: progress.blockedReason,
    completedAt: progress.terminal ? batch.completedAt ?? new Date().toISOString() : null })
  await sql`update aigc.suite_batches set state=${next.state},snapshot=${sql.json(next as never)},updated_at=now() where id=${batchId}`
  return next
}

export async function stopUnsubmittedOperations(sql: Transaction, batchId: string, reason = 'USER_STOPPED') {
  const rows = await sql`select * from aigc.suite_operations where batch_id=${batchId} order by id for update`
  for (const row of rows) {
    const operation = suiteOperationSchema.parse(row.snapshot)
    // 原任务凭据和确认中项绝不能被解释成未执行；停止使旧领取令牌立即失效。
    if (operation.task || row.source_job_id || operation.terminalState || operation.phase === 'confirming') continue
    await writeSuiteOperation(sql, { ...operation, phase: 'stopped', errorCode: reason, updatedAt: new Date().toISOString() })
    await sql`update aigc.suite_operations set lease_token=null,lease_until=null where id=${operation.id}`
  }
  return refreshSuiteBatch(sql, batchId)
}

export function stopSuiteBatch(user: SuiteUser, projectId: string, batchId: string) {
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const [batch] = await sql`select id from aigc.suite_batches where id=${batchId} and project_id=${projectId} for update`
    if (!batch) throw new HttpError(404, '批次不存在或无权访问', 'SUITE_NOT_FOUND')
    return stopUnsubmittedOperations(sql, batchId)
  })
}

export function readSuiteBatch(user: SuiteUser, projectId: string, batchId: string) {
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    const [row] = await sql`select snapshot from aigc.suite_batches where id=${batchId} and project_id=${projectId}`
    if (!row) throw new HttpError(404, '批次不存在或无权访问', 'SUITE_NOT_FOUND')
    const operations = (await sql`select snapshot from aigc.suite_operations where batch_id=${batchId} order by id`).map(row => suiteOperationSchema.parse(row.snapshot))
    const tasks = await taskRepository(queryPort(sql), user.id, runtimeScope()).batchChildren(batchId)
    return { batch: suiteBatchSchema.parse(row.snapshot), operations, tasks }
  })
}
