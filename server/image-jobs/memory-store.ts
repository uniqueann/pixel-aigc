import { randomUUID } from 'node:crypto'
import type { ImageJobItemRow, ImageJobRow, ImageJobStore, InsertImageJobInput } from './types.js'

export function createMemoryStore(userId: string, scope = 'local'): ImageJobStore & {
  jobs: Map<string, ImageJobRow>
  items: Map<string, ImageJobItemRow[]>
  leases: Set<string>
} {
  const jobs = new Map<string, ImageJobRow>()
  const items = new Map<string, ImageJobItemRow[]>()
  const leases = new Set<string>()
  const now = () => new Date()

  return {
    jobs,
    items,
    leases,
    async findById(id) {
      const job = jobs.get(id)
      return job && job.user_id === userId && job.scope === scope ? job : undefined
    },
    async findByRequestId(requestId) {
      return [...jobs.values()].find(job => job.user_id === userId && job.scope === scope && job.request_id === requestId)
    },
    async insertJob(input: InsertImageJobInput) {
      const created = now()
      const job: ImageJobRow = {
        id: input.id ?? randomUUID(),
        user_id: userId,
        scope,
        request_id: input.requestId,
        request_fingerprint: input.fingerprint,
        capability: input.capability,
        model_profile_id: input.modelProfileId,
        provider: input.provider,
        params: input.params,
        provider_params: input.providerParams,
        warnings: [...input.warnings],
        requested_count: input.requestedCount,
        status: 'queued',
        error_code: null,
        error_message: null,
        credits_reserved: input.creditsReserved,
        credits_charged: 0,
        billing_state: input.billingState,
        lease_until: null,
        next_poll_at: input.nextPollAt,
        deadline_at: input.deadlineAt,
        created_at: created,
        updated_at: created,
        completed_at: null,
        expires_at: new Date(created.getTime() + 30 * 24 * 3600 * 1000),
      }
      jobs.set(job.id, job)
      return job
    },
    async insertItems(job, count) {
      const rows = Array.from({ length: count }, (_, ordinal) => ({
        job_id: job.id,
        ordinal,
        user_id: userId,
        scope,
        provider_task_id: null,
        status: 'pending',
        attempts: 0,
        progress: null,
        result_object_key: null,
        result_mime_type: null,
        result_width: null,
        result_height: null,
        error_code: null,
        error_message: null,
        updated_at: now(),
      } satisfies ImageJobItemRow))
      items.set(job.id, rows)
      return rows
    },
    async listItems(jobId) {
      return [...(items.get(jobId) ?? [])]
    },
    async tryAcquireLease(jobId, until) {
      const job = jobs.get(jobId)
      if (!job || job.user_id !== userId) return undefined
      if (leases.has(jobId)) return undefined
      const next = { ...job, lease_until: until, updated_at: now() }
      jobs.set(jobId, next)
      leases.add(jobId)
      return next
    },
    async updateJob(id, patch) {
      const job = jobs.get(id)
      if (!job) throw new Error('missing job')
      const next = { ...job, ...patch, updated_at: now() }
      jobs.set(id, next)
      if (patch.lease_until === null) leases.delete(id)
      return next
    },
    async updateItem(jobId, ordinal, patch) {
      const rows = items.get(jobId) ?? []
      const current = rows[ordinal]
      const next = { ...current, ...patch, updated_at: now() }
      rows[ordinal] = next
      items.set(jobId, rows)
      return next
    },
    async hourlyCount() { return jobs.size },
    async userActiveCount() {
      return [...jobs.values()].filter(job => job.status === 'queued' || job.status === 'processing').length
    },
    async globalActiveCount() { return this.userActiveCount() },
    async expireUserOverdue(at) {
      for (const job of jobs.values()) {
        if ((job.status === 'queued' || job.status === 'processing') && new Date(job.deadline_at) <= at) {
          const rows = items.get(job.id) ?? []
          for (const item of rows) {
            if (item.status === 'pending' || item.status === 'submitted' || item.status === 'processing') item.status = 'expired'
          }
        }
      }
    },
  }
}
