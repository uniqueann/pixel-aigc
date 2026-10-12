import { runtimeScope, type Transaction } from '../db.js'
import type { ImageJobAttempt, ImageJobItemRow, ImageJobRow, ImageJobStore, InsertImageJobInput } from './types.js'

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
    kind: 'sql',
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
      if (input.initialLease) {
        const [leased] = await sql`update aigc.image_jobs set lease_token=gen_random_uuid(),lease_owner='submit',
          lease_until=clock_timestamp()+interval '120 seconds' where id=${row.id as string} returning *`
        return asJob(leased)
      }
      return asJob(row)
    },
    async insertItems(job, count) {
      const items: ImageJobItemRow[] = []
      for (let ordinal = 0; ordinal < count; ordinal += 1) {
        const [row] = job.capability === 'text_to_video'
          ? await sql`insert into aigc.image_job_items(job_id,ordinal,user_id,scope,status)
              values(${job.id},${ordinal},${userId},${scope},'pending') returning *`
          : await sql`insert into aigc.image_job_items(job_id,ordinal,user_id,scope,status,submission_state)
              values(${job.id},${ordinal},${userId},${scope},'pending','not_sent') returning *`
        items.push(asItem(row))
      }
      return items
    },
    async listItems(jobId) {
      const rows = await sql`select * from aigc.image_job_items
        where job_id=${jobId} and user_id=${userId} and scope=${scope} order by ordinal`
      return rows.map(asItem)
    },
    async tryAcquireLease(jobId, until, owner = 'poll') {
      const [row] = await sql`update aigc.image_jobs
        set lease_until=${media === 'video' ? until : sql`clock_timestamp()+interval '120 seconds'`},
          ${media === 'video' ? sql`` : sql`lease_token=gen_random_uuid(),lease_owner=${owner},`} updated_at=now()
        where id=${jobId} and user_id=${userId} and scope=${scope}
          and (lease_until is null or lease_until<=clock_timestamp())
        returning *`
      return row ? asJob(row) : undefined
    },
    async assertLease(jobId, token) {
      await sql`select set_config('aigc.image_lease_token',${token},true)`
      const [row] = await sql`select * from aigc.image_jobs where id=${jobId} and user_id=${userId}
        and scope=${scope} and lease_token=${token}::uuid and lease_until>clock_timestamp() for update`
      return row ? asJob(row) : undefined
    },
    async startSubmission(jobId, token, ordinals, attemptId) {
      const [row] = await sql`select * from aigc.start_image_submission(${jobId}::uuid,${token}::uuid,${ordinals}::integer[],${attemptId}::uuid)`
      return row?.id ? row as unknown as ImageJobAttempt : undefined
    },
    async recordSubmission(attemptId, receipt) {
      // 失效执行者只能补原尝试的回执，不能改任务、明细或账本。
      await sql`update aigc.image_job_attempts set provider_task_id=${receipt.provider_task_id},outcome=${receipt.outcome},
        error_code=${receipt.error_code},error_message=${receipt.error_message},retryable=${receipt.retryable}
        where id=${attemptId} and user_id=${userId} and scope=${scope} and kind='submit'
          and (outcome is null or (outcome='unknown' and ${receipt.outcome === 'accepted'}))`
    },
    async listAttempts(jobId) {
      return await sql`select * from aigc.image_job_attempts where job_id=${jobId} and user_id=${userId}
        and scope=${scope} and cleaned_at is null and cleanup_token is null order by created_at,id for update` as unknown as ImageJobAttempt[]
    },
    async startTransfer(jobId, token, ordinal, attemptId, descriptor) {
      if (!await this.assertLease(jobId, token)) throw new Error('图片任务租约已失效')
      await sql`insert into aigc.image_job_attempts(id,job_id,user_id,scope,kind,ordinals,object_key,mime_type,width,height,checksum)
        values(${attemptId},${jobId},${userId},${scope},'transfer',${[ordinal]},${descriptor.object_key},
          ${descriptor.mime_type},${descriptor.width},${descriptor.height},${descriptor.checksum})`
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
        ${media === 'video' ? sql`` : sql`lease_token=${patch.lease_token === undefined ? sql`lease_token` : patch.lease_token},
          lease_owner=${patch.lease_owner === undefined ? sql`lease_owner` : patch.lease_owner},`}
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
        ${media === 'video' ? sql`` : sql`submission_state=${patch.submission_state === undefined ? sql`submission_state` : patch.submission_state},
          submission_attempt_id=${patch.submission_attempt_id === undefined ? sql`submission_attempt_id` : patch.submission_attempt_id},`}
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
    async providerActiveCount(provider) {
      const [row] = await sql`select aigc.image_provider_active_count(${scope},${provider}) as used`
      return Number(row.used)
    },
    async modelActiveCount(modelProfileId) {
      const [row] = await sql`select aigc.image_model_active_count(${scope},${modelProfileId}) as used`
      return Number(row.used)
    },
    async expireUserOverdue(now) {
      void now
      await sql`select aigc.expire_overdue_image_jobs(${userId})`
    },
  }
}
