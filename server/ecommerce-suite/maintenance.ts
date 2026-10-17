import { randomUUID } from 'node:crypto'
import { suiteBatchSchema, suiteOperationSchema, suiteQuoteRequestSchema } from '../../shared/ecommerce-suite.js'
import { getObjectLimited } from '../storage.js'
import { HttpError } from '../errors.js'
import { runtimeScope } from '../db.js'
import { withImageMaintenance } from '../image-jobs/maintenance.js'
import { createSqlBilling } from '../image-jobs/billing.js'
import { createSqlStore } from '../image-jobs/repository.js'
import { sqlImageExecution } from '../image-jobs/execution.js'
import { advanceImageClaim, boundedImageRuntime, createImageJobInStore, createImageTaskSchema, defaultImageJobRuntime, type ImageJobRuntime } from '../image-jobs/service.js'
import { actor, fingerprint, readSuite, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'
import { planSuiteSlot, type SuitePlannedSlot } from './generation.js'
import { refreshSuiteBatch, stopUnsubmittedOperations, writeSuiteOperation } from './batches.js'
import { registerSuiteOperationResults } from './results.js'
import { suiteStorage, type SuiteStorage } from './assets.js'
import { ecommerceSuiteDispatchReady } from './config.js'

export interface SuiteClaim { id: string; user_id: string; project_id: string; batch_id: string; lease_token: string }
export const suiteClaimUser = (claim: SuiteClaim): SuiteUser => ({ id: claim.user_id, email: '', suggestedName: '', avatarUrl: null, providers: [] })
export const SUITE_MAINTENANCE_BUDGET_MS = 85_000
export const SUITE_MAINTENANCE_MAX_OPERATIONS = 7

/** 原任务在此事务中创建并绑定；所有网络和图像处理都在提交之后。 */
export async function dispatchSuiteClaim(claim: SuiteClaim, runtime = defaultImageJobRuntime()) {
  const user = suiteClaimUser(claim)
  return suiteTransaction(user, async sql => {
    const projectRow = await requireSuite(sql, claim.project_id, true, true)
    const [batchRow] = await sql`select * from aigc.suite_batches where id=${claim.batch_id} and project_id=${claim.project_id} for update`
    const [row] = await sql`select *,lease_until>clock_timestamp() as lease_valid from aigc.suite_operations where id=${claim.id} and batch_id=${claim.batch_id} for update`
    if (!row || row.lease_token !== claim.lease_token || !row.lease_valid) return { fenced: true, image: null }
    const batch = suiteBatchSchema.parse(batchRow.snapshot)
    let operation = suiteOperationSchema.parse(row.snapshot)
    if (operation.phase === 'stopped' || operation.terminalState) return { fenced: true, image: null }
    // 先查绑定和稳定原请求，保留过期原任务的创建事实，不以“未找到可读任务”重建。
    if (!operation.task && (row.source_job_id || operation.mode === 'image_edit')) {
      const [original] = await sql`select id from aigc.image_jobs where user_id=${user.id} and scope=${actor(user).runtimeScope} and request_id=${operation.requestId}`
      const sourceId = row.source_job_id ?? original?.id
      if (sourceId) {
        operation = { ...operation, phase: 'bound', task: { sourceKind: 'image_job', sourceId: String(sourceId), requestId: operation.requestId } }
        await writeSuiteOperation(sql, operation)
      }
    }
    if (operation.task || operation.phase === 'bound') return { fenced: false, image: null }
    if (operation.phase === 'confirming') return { fenced: false, image: null }
    if (projectRow.deleted_at || Date.parse(batch.dispatchDeadlineAt) <= runtime.now()) {
      await stopUnsubmittedOperations(sql, batch.id, projectRow.deleted_at ? 'PROJECT_DELETED' : 'DISPATCH_DEADLINE')
      return { fenced: false, image: null }
    }
    if (batch.state === 'blocked') return { fenced: false, image: null }
    const frozen = row.plan as unknown as SuitePlannedSlot
    const [quote] = await sql`select request from aigc.suite_quotes where id=${batch.quoteId}`
    const selection = suiteQuoteRequestSchema.parse(quote.request).slots.find(item => item.slotId === operation.slotId)!
    const project = await readSuite(sql, claim.project_id)
    const current = await planSuiteSlot(sql, { ...project, config: batch.configSnapshot }, selection, runtime, operation.id)
    if (fingerprint(frozen) !== fingerprint(current)) throw new HttpError(409, '模型、价格或实际规格已变化，请重新确认未执行项', 'SUITE_QUOTE_CHANGED')
    if (!current.execution) {
      await writeSuiteOperation(sql, { ...operation, phase: 'bound', updatedAt: new Date(runtime.now()).toISOString() })
      await refreshSuiteBatch(sql, batch.id)
      return { fenced: false, image: null }
    }
    const item = current.item
    if (item.mode !== 'image_edit') throw new HttpError(409, '原计划与处理方式不一致', 'SUITE_QUOTE_CHANGED')
    const rows = await sql`select plan from aigc.suite_operations where batch_id=${batch.id} and source_job_id is not null`
    const committed = rows.reduce((sum, op) => sum + (op.plan as unknown as SuitePlannedSlot).item.credits, 0)
    if (committed + item.credits > batch.maxCredits) throw new HttpError(409, '本批次预算不足，请重新确认未执行项', 'SUITE_BUDGET_EXCEEDED')
    await sql`select pg_advisory_xact_lock(91517002)`
    const parsed = createImageTaskSchema.parse({ requestId: operation.requestId, capability: 'image_edit', modelProfileId: item.modelProfileId,
      origin: { entry: 'ecommerce', tool: 'ecommerce-suite', projectId: batch.projectId, slotId: item.slotId, batchId: batch.id, operationId: operation.id }, params: current.execution.params })
    const original = await createImageJobInStore(createSqlStore(sql, user.id), user, parsed, { ...runtime, billing: createSqlBilling(sql) })
    if (original.bundle.job.credits_reserved !== item.credits || original.bundle.job.provider !== current.execution.provider
      || fingerprint(original.bundle.job.provider_params) !== fingerprint(current.execution.mapped))
      throw new HttpError(409, '实际任务费用或渠道与报价不一致', 'SUITE_QUOTE_CHANGED')
    operation = { ...operation, phase: 'bound', task: { sourceKind: 'image_job', sourceId: original.bundle.job.id, requestId: operation.requestId }, updatedAt: new Date(runtime.now()).toISOString() }
    await writeSuiteOperation(sql, operation)
    await refreshSuiteBatch(sql, batch.id)
    return { fenced: false, image: original.created ? original.bundle : null }
  })
}

async function recordDispatchFailure(claim: SuiteClaim, error: HttpError, runtime: ImageJobRuntime) {
  await suiteTransaction(suiteClaimUser(claim), async sql => {
    await requireSuite(sql, claim.project_id, true, true)
    await sql`select id from aigc.suite_batches where id=${claim.batch_id} for update`
    const [row] = await sql`select *,lease_until>clock_timestamp() as lease_valid from aigc.suite_operations where id=${claim.id} for update`
    if (!row || row.lease_token !== claim.lease_token || !row.lease_valid || row.source_job_id) return
    if (error.status === 429) {
      const operation = suiteOperationSchema.parse(row.snapshot)
      await writeSuiteOperation(sql, { ...operation, phase: 'waiting', errorCode: error.code, updatedAt: new Date(runtime.now()).toISOString() })
      const seconds = Math.min(3600, Math.max(5, Number(error.extra?.retryAfterSeconds) || 30))
      await sql`update aigc.suite_operations set next_attempt_at=clock_timestamp()+${seconds}*interval '1 second' where id=${claim.id}`
    } else {
      const pending = await sql`select * from aigc.suite_operations where batch_id=${claim.batch_id} order by id for update`
      for (const candidate of pending) {
        const operation = suiteOperationSchema.parse(candidate.snapshot)
        if (operation.task || operation.terminalState || ['stopped', 'confirming'].includes(operation.phase)) continue
        await writeSuiteOperation(sql, { ...operation, phase: 'blocked', errorCode: error.code, updatedAt: new Date(runtime.now()).toISOString() })
        await sql`update aigc.suite_operations set lease_token=null,lease_until=null where id=${operation.id}`
      }
    }
    await refreshSuiteBatch(sql, claim.batch_id)
  })
}

/** 一轮固定预算和项数；原任务的未知提交、轮询、结算继续由原维护器负责。 */
export async function maintainSuiteBatches(runtime = defaultImageJobRuntime(), runId = randomUUID(), storage: SuiteStorage = suiteStorage) {
  const started = runtime.now(), scope = runtimeScope()
  const bounded = boundedImageRuntime({ ...runtime, allowSubmit: ecommerceSuiteDispatchReady() }, SUITE_MAINTENANCE_BUDGET_MS)
  const resultStorage = storage === suiteStorage ? { ...storage,
    read: (key: string) => getObjectLimited(key, 20 * 1024 * 1024, bounded.signal),
    put: (key: string, bytes: Uint8Array, type: string) => storage.put(key, bytes, type, bounded.signal) } : storage
  const report = { runId, scope, claimed: 0, dispatched: 0, reconciled: 0, fenced: 0, blocked: 0, failed: 0, durationMs: 0 }
  for (let index = 0; index < SUITE_MAINTENANCE_MAX_OPERATIONS && !bounded.signal?.aborted && bounded.budgetUntil! - runtime.now() > 12_000; index++) {
    const [claim] = await withImageMaintenance(sql => sql`select * from aigc.claim_due_suite_operation(${scope},${runId}::uuid)`) as unknown as SuiteClaim[]
    if (!claim) break
    report.claimed++
    try {
      // 全局首发保护关闭时仍可登记已有结果，但不创建新的收费任务。
      if (!bounded.allowSubmit) {
        const [row] = await suiteTransaction(suiteClaimUser(claim), sql => sql`select source_job_id,snapshot from aigc.suite_operations where id=${claim.id}`)
        if (!row.source_job_id && row.snapshot.phase !== 'bound') {
          await suiteTransaction(suiteClaimUser(claim), async sql => {
            const project = await requireSuite(sql, claim.project_id, true, true)
            const [batch] = await sql`select snapshot from aigc.suite_batches where id=${claim.batch_id} for update`
            if (project.deleted_at || Date.parse(suiteBatchSchema.parse(batch.snapshot).dispatchDeadlineAt) <= runtime.now()) {
              await stopUnsubmittedOperations(sql, claim.batch_id, project.deleted_at ? 'PROJECT_DELETED' : 'DISPATCH_DEADLINE')
              return
            }
            const [waiting] = await sql`select *,lease_until>clock_timestamp() as lease_valid from aigc.suite_operations where id=${claim.id} for update`
            if (waiting?.lease_token !== claim.lease_token || !waiting.lease_valid) return
            const operation = suiteOperationSchema.parse(waiting.snapshot)
            if (!operation.task && ['waiting', 'dispatching'].includes(operation.phase)) {
              await writeSuiteOperation(sql, { ...operation, phase: 'waiting', errorCode: 'BACKGROUND_SUBMIT_DISABLED', updatedAt: new Date(runtime.now()).toISOString() })
              await sql`update aigc.suite_operations set next_attempt_at=clock_timestamp()+interval '60 seconds' where id=${claim.id}`
              await refreshSuiteBatch(sql, claim.batch_id)
            }
          })
          continue
        }
      }
      const dispatched = await dispatchSuiteClaim(claim, bounded)
      if (dispatched.fenced) { report.fenced++; continue }
      if (dispatched.image) {
        report.dispatched++
        await advanceImageClaim(dispatched.image, { ...bounded, execution: sqlImageExecution(claim.user_id, '') }, true)
      }
      await registerSuiteOperationResults(suiteClaimUser(claim), claim.project_id, claim.batch_id, claim.id, resultStorage, claim.lease_token)
      report.reconciled++
    } catch (error) {
      if (error instanceof HttpError && [400, 402, 409, 429, 503].includes(error.status)) {
        await recordDispatchFailure(claim, error, bounded)
        if (error.status !== 429) report.blocked++
      } else report.failed++
      bounded.log({ stage: 'suite-operation-error', runId, scope, operationId: claim.id, code: error instanceof HttpError ? error.code : 'SUITE_MAINTENANCE_FAILED' })
    } finally {
      await suiteTransaction(suiteClaimUser(claim), async sql => {
        await sql`update aigc.suite_operations set lease_token=null,lease_until=null,
          next_attempt_at=greatest(next_attempt_at,clock_timestamp()+interval '5 seconds') where id=${claim.id} and lease_token=${claim.lease_token}`
      })
    }
  }
  report.durationMs = runtime.now() - started
  runtime.log({ stage: 'suite-maintenance-complete', ...report })
  return report
}
