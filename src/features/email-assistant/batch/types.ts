import type { EmailAssistTaskParams } from '@/types'
import type { EMAIL_BATCH_HEADERS } from '../options'

export type EmailBatchStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'invalid' | 'uncertain'
export type EmailBatchOriginal = Record<(typeof EMAIL_BATCH_HEADERS)[number], string>

export interface EmailBatchRow {
  id: string
  recordNumber: number
  original: EmailBatchOriginal
  params?: EmailAssistTaskParams
  status: EmailBatchStatus
  requestId?: string
  taskId?: string
  resultText?: string
  errorCode?: string
  errorMessage?: string
}

export interface EmailBatchState {
  rows: EmailBatchRow[]
  fileName?: string
  modelProfileId?: string
  runState: 'idle' | 'running' | 'pausing' | 'paused' | 'completed'
  pauseMessage?: string
  recovering: boolean
}

export const EMAIL_BATCH_STATUS_LABELS: Record<EmailBatchStatus, string> = {
  pending: '待处理', processing: '生成中', succeeded: '成功',
  failed: '失败', invalid: '填写错误', uncertain: '待确认',
}
