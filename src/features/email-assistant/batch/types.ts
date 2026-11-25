import { i18n } from '@/i18n'
import zhEmail from '@/i18n/locales/zh-CN/email.json'
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
  modelProfileId?: string
  priceVersion?: string
  creditsCost?: number
  taskId?: string
  resultText?: string
  errorCode?: string
  errorMessage?: string
}

export interface EmailBatchState {
  rows: EmailBatchRow[]
  fileName?: string
  modelProfileId?: string
  priceVersion?: string
  runState: 'idle' | 'running' | 'pausing' | 'paused' | 'completed'
  pauseMessage?: string
  recovering: boolean
}

export function emailBatchStatusLabel(status: EmailBatchStatus): string {
  switch (status) {
    case 'pending': return i18n.t('email:batch.status.pending')
    case 'processing': return i18n.t('email:batch.status.processing')
    case 'succeeded': return i18n.t('email:batch.status.succeeded')
    case 'failed': return i18n.t('email:batch.status.failed')
    case 'invalid': return i18n.t('email:batch.status.invalid')
    case 'uncertain': return i18n.t('email:batch.status.uncertain')
  }
}

export const EMAIL_BATCH_STATUS_LABELS: Record<EmailBatchStatus, string> = {
  pending: zhEmail.batch.status.pending,
  processing: zhEmail.batch.status.processing,
  succeeded: zhEmail.batch.status.succeeded,
  failed: zhEmail.batch.status.failed,
  invalid: zhEmail.batch.status.invalid,
  uncertain: zhEmail.batch.status.uncertain,
}
