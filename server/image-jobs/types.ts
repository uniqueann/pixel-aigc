import type { TaskOrigin } from '../../shared/task-center.js'
export interface ImageJobRow {
  origin?: TaskOrigin | null
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
  lease_token?: string | null
  lease_owner?: 'submit' | 'poll' | 'maintenance' | null
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
  submission_state?: 'not_sent' | 'sending' | 'accepted' | 'unknown' | null
  submission_attempt_id?: string | null
  status: string
  attempts: number
  progress: number | null
  result_object_key: string | null
  result_mime_type: string | null
  result_width: number | null
  result_height: number | null
  result_metadata?: Record<string, unknown> | null
  error_code: string | null
  error_message: string | null
  updated_at: Date | string
}

export interface ImageJobBundle {
  job: ImageJobRow
  items: ImageJobItemRow[]
}

export interface InsertImageJobInput {
  origin?: TaskOrigin
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
  initialLease?: boolean
}

export interface ImageJobAttempt {
  id: string
  job_id: string
  user_id: string
  scope: string
  kind: 'submit' | 'transfer'
  ordinals: number[]
  provider_task_id: string | null
  outcome: 'accepted' | 'not_sent' | 'rejected' | 'unknown' | null
  error_code: string | null
  error_message: string | null
  retryable: boolean
  object_key: string | null
  mime_type: string | null
  width: number | null
  height: number | null
  checksum: string | null
  created_at: Date | string
  cleaned_at?: Date | string | null
  cleanup_token?: string | null
}

export type AttemptReceipt = Pick<ImageJobAttempt, 'provider_task_id' | 'outcome' | 'error_code' | 'error_message' | 'retryable'>
export type TransferDescriptor = Pick<ImageJobAttempt, 'object_key' | 'mime_type' | 'width' | 'height' | 'checksum'>

export interface ImageJobStore {
  /** 持久套图输入除了路径还必须核对资产登记与当前归属。 */
  suiteAssetReady?(key: string): Promise<boolean>
  kind: 'sql' | 'memory'
  findById(id: string): Promise<ImageJobRow | undefined>
  findByRequestId(requestId: string): Promise<ImageJobRow | undefined>
  insertJob(input: InsertImageJobInput): Promise<ImageJobRow>
  insertItems(job: ImageJobRow, count: number): Promise<ImageJobItemRow[]>
  listItems(jobId: string): Promise<ImageJobItemRow[]>
  tryAcquireLease(jobId: string, until: Date, owner?: 'submit' | 'poll' | 'maintenance'): Promise<ImageJobRow | undefined>
  assertLease(jobId: string, token: string): Promise<ImageJobRow | undefined>
  startSubmission(jobId: string, token: string, ordinals: number[], attemptId: string): Promise<ImageJobAttempt | undefined>
  recordSubmission(attemptId: string, receipt: AttemptReceipt): Promise<void>
  listAttempts(jobId: string): Promise<ImageJobAttempt[]>
  startTransfer(jobId: string, token: string, ordinal: number, attemptId: string, descriptor: TransferDescriptor): Promise<void>
  updateJob(id: string, patch: Partial<ImageJobRow>): Promise<ImageJobRow>
  updateItem(jobId: string, ordinal: number, patch: Partial<ImageJobItemRow>): Promise<ImageJobItemRow>
  hourlyCount(): Promise<number>
  hourlyOldest(): Promise<Date | undefined>
  userActiveCount(): Promise<number>
  globalActiveCount(): Promise<number>
  /** 当前环境里该供应商尚未结束的图片任务，跨用户。 */
  providerActiveCount(provider: string): Promise<number>
  /** 当前环境里该模型尚未结束的图片任务，跨用户。 */
  modelActiveCount(modelProfileId: string): Promise<number>
  expireUserOverdue(now: Date): Promise<void>
}
