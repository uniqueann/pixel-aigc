export interface ImageJobRow {
  id: string
  user_id: string
  scope: string
  request_id: string
  request_fingerprint: string
  capability: string
  model_profile_id: string
  provider: string
  params: Record<string, unknown>
  provider_params: Record<string, unknown>
  warnings: string[]
  requested_count: number
  status: string
  error_code: string | null
  error_message: string | null
  credits_reserved: number
  credits_charged: number
  billing_state: string
  lease_until: Date | string | null
  next_poll_at: Date | string
  deadline_at: Date | string
  created_at: Date | string
  updated_at: Date | string
  completed_at: Date | string | null
  expires_at: Date | string
}

export interface ImageJobItemRow {
  job_id: string
  ordinal: number
  user_id: string
  scope: string
  provider_task_id: string | null
  status: string
  attempts: number
  progress: number | null
  result_object_key: string | null
  result_mime_type: string | null
  result_width: number | null
  result_height: number | null
  error_code: string | null
  error_message: string | null
  updated_at: Date | string
}

export interface ImageJobBundle {
  job: ImageJobRow
  items: ImageJobItemRow[]
}

export interface InsertImageJobInput {
  id?: string
  requestId: string
  fingerprint: string
  capability: string
  modelProfileId: string
  provider: string
  params: Record<string, unknown>
  providerParams: Record<string, unknown>
  warnings: string[]
  requestedCount: number
  creditsReserved: number
  billingState: 'none' | 'reserved'
  deadlineAt: Date
  nextPollAt: Date
}

export interface ImageJobStore {
  findById(id: string): Promise<ImageJobRow | undefined>
  findByRequestId(requestId: string): Promise<ImageJobRow | undefined>
  insertJob(input: InsertImageJobInput): Promise<ImageJobRow>
  insertItems(job: ImageJobRow, count: number): Promise<ImageJobItemRow[]>
  listItems(jobId: string): Promise<ImageJobItemRow[]>
  tryAcquireLease(jobId: string, until: Date): Promise<ImageJobRow | undefined>
  updateJob(id: string, patch: Partial<ImageJobRow>): Promise<ImageJobRow>
  updateItem(jobId: string, ordinal: number, patch: Partial<ImageJobItemRow>): Promise<ImageJobItemRow>
  hourlyCount(): Promise<number>
  hourlyOldest(): Promise<Date | undefined>
  userActiveCount(): Promise<number>
  globalActiveCount(): Promise<number>
  expireUserOverdue(now: Date): Promise<void>
}
