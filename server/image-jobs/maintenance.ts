import { randomUUID } from 'node:crypto'
import { database,runtimeScope,type Transaction } from '../db.js'
import { deleteObject } from '../storage.js'
import { sqlImageExecution } from './execution.js'
import { advanceImageClaim,boundedImageRuntime,defaultImageJobRuntime,type ImageJobRuntime } from './service.js'

export const IMAGE_MAINTENANCE_BUDGET_MS = 90_000
export const IMAGE_MAINTENANCE_MAX_JOBS = 4
export const IMAGE_MAINTENANCE_PARALLEL = 2

export interface ImageClaim { id: string; user_id: string; scope: string; lease_token: string }

export async function withImageMaintenance<T>(action: (sql: Transaction) => Promise<T>): Promise<T> {
  return database().begin(async sql => {
    await sql`set local role aigc_api`
    await sql`select set_config('aigc.user_id','',true),set_config('aigc.email','',true),set_config('aigc.scope',${runtimeScope()},true)`
    await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
    return action(sql)
  }) as Promise<T>
}

/** 每轮有固定上限；领取、外部 I/O 和收尾使用各自的短事务。 */
export async function maintainImageJobs(runtime = defaultImageJobRuntime(),runId = randomUUID()) {
  const scope = runtimeScope()
  const started = runtime.now()
  const bounded = boundedImageRuntime({ ...runtime,allowSubmit: process.env.IMAGE_BACKGROUND_SUBMIT_ENABLED === 'true' },IMAGE_MAINTENANCE_BUDGET_MS)
  const report = { runId,scope,claimed: 0,advanced: 0,terminal: 0,unknown: 0,fenceRejected: 0,failed: 0,
    imageExpired: 0,syncExpired: 0,orphansDeleted: 0,budgetExhausted: false,durationMs: 0 }
  const log = (entry: Record<string,unknown>) => runtime.log({ runId,scope,...entry })
  bounded.log = entry => {
    if (entry.stage === 'fence-rejected') report.fenceRejected += 1
    log(entry)
  }
  try {
    const expired = await withImageMaintenance(async sql => {
      const [images] = await sql`select aigc.expire_overdue_image_jobs() as count`
      const [sync] = await sql`select aigc.expire_sync_credits() as count`
      return { images: Number(images.count),sync: Number(sync.count) }
    })
    report.imageExpired = expired.images
    report.syncExpired = expired.sync
    let tickets = 0
    const worker = async () => {
      while (tickets < IMAGE_MAINTENANCE_MAX_JOBS && !bounded.signal?.aborted
        && bounded.budgetUntil! - runtime.now() > 10_000) {
        tickets += 1
        const [claim] = await withImageMaintenance(sql => sql`select * from aigc.claim_due_image_job(${scope})`) as unknown as ImageClaim[]
        if (!claim) return
        report.claimed += 1
        const execution = sqlImageExecution(claim.user_id,'')
        try {
          const prepared = await execution.transaction(async store => {
            const job = await store.assertLease(claim.id,claim.lease_token)
            return job ? { job,items: await store.listItems(job.id) } : undefined
          })
          if (!prepared) { report.fenceRejected += 1; continue }
          const result = await advanceImageClaim(prepared,{ ...bounded,execution })
          report.advanced += 1
          if (!['queued','processing'].includes(result.job.status)) report.terminal += 1
          report.unknown += result.items.filter(item => item.submission_state === 'unknown' && !item.result_object_key).length
        } catch {
          report.failed += 1
          log({ stage: 'image-maintenance-item-failed',jobId: claim.id,code: 'ADVANCE_FAILED' })
        }
      }
    }
    await Promise.all(Array.from({ length: IMAGE_MAINTENANCE_PARALLEL },worker))
    if (!bounded.signal?.aborted && bounded.budgetUntil! - runtime.now() > 15_000) {
      const orphans = await withImageMaintenance(sql => sql`select * from aigc.claim_image_orphans(${scope})`) as unknown as Array<{ id: string; object_key: string; cleanup_token: string }>
      for (const orphan of orphans) {
        if (bounded.signal?.aborted) break
        await deleteObject(orphan.object_key,bounded.signal)
        await withImageMaintenance(sql => sql`select aigc.finish_image_orphan(${orphan.id}::uuid,${orphan.cleanup_token}::uuid)`)
        report.orphansDeleted += 1
      }
    }
  } catch {
    report.failed += 1
    log({ stage: 'image-maintenance-failed',code: 'MAINTENANCE_FAILED' })
  }
  report.budgetExhausted = !!bounded.signal?.aborted || runtime.now() >= bounded.budgetUntil!
  report.durationMs = runtime.now() - started
  log({ stage: 'image-maintenance-complete',...report })
  return report
}

export type ImageMaintenanceRuntime = ImageJobRuntime
