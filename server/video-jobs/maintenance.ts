import { z } from 'zod'
import { database, runtimeScope, withIdentity, type Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { createSqlStore } from '../image-jobs/repository.js'
import { createSqlBilling, noopBilling } from '../image-jobs/billing.js'
import { finalizeJob } from '../image-jobs/service.js'
import { deleteObject } from '../storage.js'
import { validCallbackToken } from '../video-providers/seedance/config.js'
import { collectVideoOutcome, defaultVideoJobRuntime, type VideoJobRuntime } from './service.js'

interface VideoClaim { id: string; user_id: string; scope: string; lease_until: Date | string; cleanup: boolean }

export async function withVideoMaintenance<T>(action: (sql: Transaction) => Promise<T>): Promise<T> {
  return database().begin(async sql => {
    await sql`set local role aigc_api`
    await sql`select set_config('aigc.user_id','',true),set_config('aigc.email','',true),set_config('aigc.scope',${runtimeScope()},true)`
    return action(sql)
  }) as Promise<T>
}

export async function recordVideoCallback(query: URLSearchParams, body: unknown) {
  const jobId = z.uuid().parse(query.get('jobId'))
  const scope = query.get('scope') ?? ''
  if (scope !== runtimeScope() || !validCallbackToken(jobId, scope, query.get('token') ?? '')) throw new HttpError(401, '视频回调未授权', 'AUTH_REQUIRED')
  const parsed = z.object({ id: z.string().regex(/^cgt-[\w-]+$/) }).passthrough().parse(body)
  const owner = await withVideoMaintenance(async sql => {
    const [row] = await sql`select * from aigc.video_job_owner(${jobId},${scope})`
    return row as { id: string; user_id: string } | undefined
  })
  if (!owner) return undefined
  await withIdentity(owner.user_id, '', async sql => {
    const store = createSqlStore(sql, owner.user_id, 'video')
    await sql`select id from aigc.image_jobs where id=${owner.id} for update`
    const job = await store.findById(owner.id)
    if (!job || job.status === 'succeeded' || job.status === 'failed') return
    const [item] = await store.listItems(job.id)
    if (item.provider_task_id && item.provider_task_id !== parsed.id) throw new HttpError(409, '视频回调任务不匹配', 'REQUEST_CONFLICT')
    // 回调仅提供候选任务标识，真正状态和结果由鉴权查询核实。
    await store.updateJob(job.id, { provider_params: { ...job.provider_params, callbackTaskId: parsed.id }, next_poll_at: new Date() })
  })
  return jobId
}

async function advanceClaim(claim: VideoClaim, runtime: VideoJobRuntime) {
  const prepared = await withIdentity(claim.user_id, '', async sql => {
    const store = createSqlStore(sql, claim.user_id, 'video')
    const job = await store.findById(claim.id)
    if (!job || new Date(job.lease_until ?? 0).getTime() !== new Date(claim.lease_until).getTime()) return undefined
    return { job, items: await store.listItems(job.id) }
  })
  if (!prepared) return
  const guard = async (sql: Transaction) => {
    const [row] = await sql`select id from aigc.image_jobs
      where id=${claim.id} and lease_until=${new Date(claim.lease_until)} and lease_until>now() for update`
    if (!row) throw new Error('视频任务租约已失效')
  }
  const outcome = await collectVideoOutcome(prepared, runtime, async providerParams => {
    await withIdentity(claim.user_id, '', async sql => {
      await guard(sql)
      const store = createSqlStore(sql, claim.user_id, 'video')
      const current = (await store.findById(claim.id))!
      await store.updateJob(claim.id, { provider_params: { ...current.provider_params, ...providerParams } })
    })
  })
  await withIdentity(claim.user_id, '', async sql => {
    await guard(sql)
    const store = createSqlStore(sql, claim.user_id, 'video')
    const current = (await store.findById(claim.id))!
    const items = await store.listItems(claim.id)
    items[0] = await store.updateItem(claim.id, 0, outcome.patch)
    const late = current.billing_state === 'released' || runtime.now() >= new Date(current.deadline_at).getTime()
    const bundle = await finalizeJob(store, { ...current, provider_params: { ...current.provider_params, ...outcome.providerParams } }, items,
      { ...runtime, billing: runtime.billing === noopBilling ? createSqlBilling(sql) : runtime.billing }, late)
    const retry = Number(bundle.job.provider_params.transferAttempts ?? 0)
    if (['queued', 'processing', 'expired'].includes(bundle.job.status)) {
      const delay = bundle.job.status === 'expired' ? 300_000 : retry ? [30_000, 60_000, 120_000, 300_000][Math.min(retry - 1, 3)] : 60_000
      await store.updateJob(claim.id, { next_poll_at: new Date(runtime.now() + delay) })
    }
  })
}

export async function maintainVideoJobs(jobId?: string, runtime = defaultVideoJobRuntime()) {
  const claims = await withVideoMaintenance(async sql =>
    await sql`select * from aigc.claim_due_video_jobs(${runtimeScope()},${jobId ?? null}::uuid)` as unknown as VideoClaim[])
  const results = await Promise.allSettled(claims.map(async claim => {
    if (claim.cleanup) {
      const prefix = `generated/${claim.user_id}/video/${claim.id}/`
      const signal = AbortSignal.timeout(100_000)
      await Promise.all([deleteObject(`${prefix}0.mp4`, signal), deleteObject(`${prefix}poster.jpg`, signal)])
      await withVideoMaintenance(sql => sql`select aigc.delete_expired_video_job(${claim.id},${claim.scope},${new Date(claim.lease_until)})`)
      return
    }
    await advanceClaim(claim, runtime)
  }))
  results.forEach((result, index) => {
    if (result.status === 'rejected') runtime.log({ stage: 'video-maintenance', jobId: claims[index].id, code: 'ADVANCE_FAILED' })
  })
  runtime.log({ stage: 'video-maintenance-complete', claimed: claims.length, failed: results.filter(result => result.status === 'rejected').length })
  return { claimed: claims.length }
}
