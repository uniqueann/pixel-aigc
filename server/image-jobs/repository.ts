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

export function createSqlStore(sql: Transaction, userId: string, media: 'image' | 'video' = 'image'): ImageJobStore {
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
        expires_at=${patch.expires_at ?? sql`expires_at`},
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
        ${patch.result_metadata === undefined ? sql`` : sql`result_metadata=${sql.json(patch.result_metadata as never)},`}
        error_code=${patch.error_code === undefined ? sql`error_code` : patch.error_code},
        error_message=${patch.error_message === undefined ? sql`error_message` : patch.error_message},
        updated_at=now()
        where job_id=${jobId} and ordinal=${ordinal} and user_id=${userId} and scope=${scope} returning *`
      return asItem(row)
    },
    async hourlyCount() {
      const [row] = await sql`select count(*)::integer as used from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and created_at>now()-interval '1 hour'
          and (capability='text_to_video')=${media === 'video'}`
      return Number(row.used)
    },
    async hourlyOldest() {
      const [row] = await sql`select min(created_at) as oldest from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and created_at>now()-interval '1 hour'
          and (capability='text_to_video')=${media === 'video'}`
      return row.oldest ? new Date(row.oldest as Date | string) : undefined
    },
    async userActiveCount() {
      const [row] = await sql`select count(*)::integer as used from aigc.image_jobs
        where user_id=${userId} and scope=${scope} and status in ('queued','processing') and deadline_at>now()
          and (capability='text_to_video')=${media === 'video'}`
      return Number(row.used)
    },
    async globalActiveCount() {
      const [row] = media === 'video'
        ? await sql`select aigc.video_processing_count(${scope}) as used`
        : await sql`select aigc.image_processing_count(${scope}) as used`
      return Number(row.used)
    },
    async expireUserOverdue(now) {
      void now
      await sql`select aigc.expire_overdue_image_jobs(${userId})`
    },
  }
}
