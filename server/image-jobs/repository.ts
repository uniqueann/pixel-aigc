import { runtimeScope, type Transaction } from '../db.js'
import type { ImageJobItemRow, ImageJobRow, ImageJobStore, InsertImageJobInput } from './types.js'

function asJob(row: Record<string, unknown>): ImageJobRow {
  return {
    ...row,
    params: (row.params ?? {}) as Record<string, unknown>,
    provider_params: (row.provider_params ?? {}) as Record<string, unknown>,
    warnings: Array.isArray(row.warnings) ? row.warnings as string[] : [],
  } as ImageJobRow
}

function asItem(row: Record<string, unknown>): ImageJobItemRow {
  return row as unknown as ImageJobItemRow
}

export function createSqlStore(sql: Transaction, userId: string): ImageJobStore {
  const scope = runtimeScope()
  return {
    async findById(id) {
      const [row] = await sql`select * from aigc.image_jobs
        where id=${id} and user_id=${userId} and scope=${scope} and expires_at>now()`
      return row ? asJob(row) : undefined
    },
    async findByRequestId(requestId) {
      const [row] = await sql`select * from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and request_id=${requestId} and expires_at>now()`
      return row ? asJob(row) : undefined
    },
    async insertJob(input: InsertImageJobInput) {
      const [row] = input.id
        ? await sql`insert into aigc.image_jobs(
            id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,
            params,provider_params,warnings,requested_count,status,credits_reserved,billing_state,
            deadline_at,next_poll_at
          ) values(
            ${input.id},${userId},${scope},${input.requestId},${input.fingerprint},${input.capability},
            ${input.modelProfileId},${input.provider},${sql.json(input.params as never)},${sql.json(input.providerParams as never)},
            ${input.warnings},${input.requestedCount},'queued',${input.creditsReserved},${input.billingState},
            ${input.deadlineAt},${input.nextPollAt}
          ) returning *`
        : await sql`insert into aigc.image_jobs(
            user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,
            params,provider_params,warnings,requested_count,status,credits_reserved,billing_state,
            deadline_at,next_poll_at
          ) values(
            ${userId},${scope},${input.requestId},${input.fingerprint},${input.capability},
            ${input.modelProfileId},${input.provider},${sql.json(input.params as never)},${sql.json(input.providerParams as never)},
            ${input.warnings},${input.requestedCount},'queued',${input.creditsReserved},${input.billingState},
            ${input.deadlineAt},${input.nextPollAt}
          ) returning *`
      return asJob(row)
    },
    async insertItems(job, count) {
      const items: ImageJobItemRow[] = []
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const [row] = await sql`insert into aigc.image_job_items(job_id,ordinal,user_id,scope,status)
          values(${job.id},${ordinal},${userId},${scope},'pending') returning *`
        items.push(asItem(row))
      }
      return items
    },
    async listItems(jobId) {
      const rows = await sql`select * from aigc.image_job_items
        where job_id=${jobId} and user_id=${userId} and scope=${scope} order by ordinal`
      return rows.map(asItem)
    },
    async tryAcquireLease(jobId, until) {
      const [row] = await sql`update aigc.image_jobs
        set lease_until=${until}, updated_at=now()
        where id=${jobId} and user_id=${userId} and scope=${scope}
          and (lease_until is null or lease_until<now())
        returning *`
      return row ? asJob(row) : undefined
    },
    async updateJob(id, patch) {
      const [row] = await sql`update aigc.image_jobs set
        status=${patch.status ?? sql`status`},
        warnings=${patch.warnings ?? sql`warnings`},
        error_code=${patch.error_code === undefined ? sql`error_code` : patch.error_code},
        error_message=${patch.error_message === undefined ? sql`error_message` : patch.error_message},
        credits_charged=${patch.credits_charged ?? sql`credits_charged`},
        billing_state=${patch.billing_state ?? sql`billing_state`},
        provider_params=${patch.provider_params === undefined ? sql`provider_params` : sql.json(patch.provider_params as never)},
        lease_until=${patch.lease_until === undefined ? sql`lease_until` : patch.lease_until},
        next_poll_at=${patch.next_poll_at ?? sql`next_poll_at`},
        completed_at=${patch.completed_at === undefined ? sql`completed_at` : patch.completed_at},
        updated_at=now()
        where id=${id} and user_id=${userId} and scope=${scope} returning *`
      return asJob(row)
    },
    async updateItem(jobId, ordinal, patch) {
      const [row] = await sql`update aigc.image_job_items set
        provider_task_id=${patch.provider_task_id === undefined ? sql`provider_task_id` : patch.provider_task_id},
        status=${patch.status ?? sql`status`},
        attempts=${patch.attempts ?? sql`attempts`},
        progress=${patch.progress === undefined ? sql`progress` : patch.progress},
        result_object_key=${patch.result_object_key === undefined ? sql`result_object_key` : patch.result_object_key},
        result_mime_type=${patch.result_mime_type === undefined ? sql`result_mime_type` : patch.result_mime_type},
        result_width=${patch.result_width === undefined ? sql`result_width` : patch.result_width},
        result_height=${patch.result_height === undefined ? sql`result_height` : patch.result_height},
        error_code=${patch.error_code === undefined ? sql`error_code` : patch.error_code},
        error_message=${patch.error_message === undefined ? sql`error_message` : patch.error_message},
        updated_at=now()
        where job_id=${jobId} and ordinal=${ordinal} and user_id=${userId} and scope=${scope} returning *`
      return asItem(row)
    },
    async hourlyCount() {
      const [row] = await sql`select count(*)::integer as used from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and created_at>now()-interval '1 hour'`
      return Number(row.used)
    },
    async userActiveCount() {
      const [row] = await sql`select count(*)::integer as used from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and status in ('queued','processing') and deadline_at>now()`
      return Number(row.used)
    },
    async globalActiveCount() {
      const [row] = await sql`select aigc.image_processing_count(${scope}) as used`
      return Number(row.used)
    },
    async expireUserOverdue(now) {
      const jobs = await sql`select * from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and status in ('queued','processing') and deadline_at<=${now}`
      for (const job of jobs) {
        await sql`update aigc.image_job_items set status='expired', updated_at=now()
          where job_id=${job.id} and status in ('pending','submitted','processing')`
        const items = await sql`select status from aigc.image_job_items where job_id=${job.id}`
        const succeeded = items.some(item => item.status === 'succeeded')
        const warnings = succeeded && items.some(item => item.status !== 'succeeded')
          ? [...new Set([...(Array.isArray(job.warnings) ? job.warnings as string[] : []), 'PARTIAL'])]
          : job.warnings
        await sql`update aigc.image_jobs set
          status=${succeeded ? 'succeeded' : 'expired'},
          warnings=${warnings},
          error_code=${succeeded ? job.error_code : 'TASK_TIMEOUT'},
          error_message=${succeeded ? job.error_message : '任务处理超时，请重试'},
          billing_state=${job.billing_state === 'reserved' ? 'released' : job.billing_state},
          completed_at=coalesce(completed_at, now()),
          updated_at=now()
          where id=${job.id}`
      }
    },
  }
}
