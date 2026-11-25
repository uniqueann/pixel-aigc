import { i18n } from '@/i18n'
import { translateApiError, translateLegacyDbText } from '@/i18n/apiErrors'
import { activeLocale } from '@/i18n/format'
import { modelDisplayName } from '@shared/model-display'
import {
  taskTools,
  type TaskCenterSummary,
  type TaskSourceKind,
  type TaskState,
  type TaskTool,
} from '@shared/task-center'

const CJK_RE = /[\u4e00-\u9fff]/
const TOOL_SET = new Set<string>(taskTools)
const TASK_STATE_KEYS: Record<TaskState, string> = {
  queued: 'taskCenter:states.queued',
  processing: 'taskCenter:states.processing',
  succeeded: 'taskCenter:states.succeeded',
  failed: 'taskCenter:states.failed',
  expired: 'taskCenter:states.expired',
  cancelled: 'taskCenter:states.cancelled',
}
const NOT_APPLICABLE_MODEL_SENTINEL = modelDisplayName(null)
const UNKNOWN_MODEL_SENTINEL = modelDisplayName('__unknown_model_sentinel__')

export type ToolFallbackKind = 'default' | 'short' | 'history' | 'result'

export function relativeTime(value: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return i18n.t('taskCenter:relativeTime.justNow')
  if (seconds < 3600) {
    return i18n.t('taskCenter:relativeTime.minutesAgo', {
      count: Math.floor(seconds / 60),
    })
  }
  if (seconds < 86400) {
    return i18n.t('taskCenter:relativeTime.hoursAgo', {
      count: Math.floor(seconds / 3600),
    })
  }
  return i18n.t('taskCenter:relativeTime.daysAgo', {
    count: Math.floor(seconds / 86400),
  })
}

export function taskToolLabel(
  tool: TaskTool | null | undefined,
  fallback: ToolFallbackKind = 'default',
): string {
  if (tool) {
    return TOOL_SET.has(tool) ? i18n.t(`taskCenter:tools.${tool}` as never) : tool
  }
  return i18n.t(`taskCenter:toolFallback.${fallback}` as never)
}

export function localizedTaskStateLabel(
  task: Pick<TaskCenterSummary, 'state' | 'partial'>,
): string {
  if (task.partial) return i18n.t('taskCenter:states.partial')
  const key = TASK_STATE_KEYS[task.state]
  return key ? i18n.t(key as never) : task.state
}

export function localizedTaskBillingLabel(
  task: Pick<
    TaskCenterSummary,
    | 'billingState'
    | 'creditsReserved'
    | 'creditsCharged'
    | 'creditsReturned'
    | 'knownCreditsCharged'
  > & { sourceKind?: TaskSourceKind },
): string {
  if (task.sourceKind === 'suite_batch' && task.billingState === 'none') {
    return i18n.t('taskCenter:billing.suiteUnreserved')
  }
  if (task.billingState === 'none') {
    return i18n.t('taskCenter:billing.free')
  }
  if (task.billingState === 'reserved') {
    return task.creditsReserved === 0
      ? i18n.t('taskCenter:billing.reservedFree')
      : i18n.t('taskCenter:billing.reservedAmount', {
          credits: task.creditsReserved,
        })
  }
  if (task.billingState === 'unknown') {
    return task.knownCreditsCharged
      ? i18n.t('taskCenter:billing.settlingKnown', {
          credits: task.knownCreditsCharged,
        })
      : i18n.t('taskCenter:billing.settling')
  }
  if (task.billingState === 'refunded') {
    return task.creditsReturned
      ? i18n.t('taskCenter:billing.refundedAmount', {
          credits: task.creditsReturned,
        })
      : i18n.t('taskCenter:billing.notCharged')
  }
  const charged = task.creditsCharged ?? 0
  if (task.creditsReturned) {
    return charged === 0
      ? i18n.t('taskCenter:billing.freeWithRefund', {
          returned: task.creditsReturned,
        })
      : i18n.t('taskCenter:billing.chargedWithRefund', {
          charged,
          returned: task.creditsReturned,
        })
  }
  return charged === 0
    ? i18n.t('taskCenter:billing.free')
    : i18n.t('taskCenter:billing.chargedAmount', { credits: charged })
}

export function localizedModelDisplayName(id: string | null | undefined): string {
  if (!id) return i18n.t('taskCenter:model.notApplicable')
  if (id === 'mock:image-stage2') return i18n.t('taskCenter:model.mockStage2')
  const name = modelDisplayName(id)
  if (name === NOT_APPLICABLE_MODEL_SENTINEL) {
    return i18n.t('taskCenter:model.notApplicable')
  }
  if (name === UNKNOWN_MODEL_SENTINEL) {
    return i18n.t('taskCenter:model.legacyModel')
  }
  if (activeLocale() === 'en-US' && CJK_RE.test(name)) {
    return i18n.t('taskCenter:model.legacyModel')
  }
  return name
}

function isErrorCodeToken(value: string): boolean {
  return /^[A-Z0-9_]+$/.test(value) && i18n.exists(`errors:codes.${value}`)
}

export function formatTaskErrorMessage(
  task: Pick<TaskCenterSummary, 'errorCode' | 'requestId'>,
  errorMessage: string | null | undefined,
): string | null {
  const raw = errorMessage?.trim() || undefined
  const code = task.errorCode?.trim() || undefined
  if (!raw && !code) return null

  if (raw && isErrorCodeToken(raw)) {
    return i18n.t(`errors:codes.${raw}` as never)
  }
  if (!raw && code && i18n.exists(`errors:codes.${code}`)) {
    return i18n.t(`errors:codes.${code}` as never)
  }

  return translateApiError({
    code,
    message: raw,
    requestId: task.requestId,
    fallback:
      activeLocale() === 'zh-CN'
        ? undefined
        : i18n.t('taskCenter:errors.taskFailedFallback'),
  })
}

function isCodedError(
  error: unknown,
): error is Error & {
  status?: number
  code?: string
  extra?: Record<string, unknown>
} {
  return error instanceof Error && ('code' in error || 'status' in error)
}

export function formatCaughtError(error: unknown, fallbackKey: string): string {
  const fallback = i18n.t(fallbackKey as never)
  if (isCodedError(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined
    const status = typeof error.status === 'number' ? error.status : undefined
    const extra =
      error.extra && typeof error.extra === 'object' ? error.extra : undefined
    const raw = error.message?.trim() || undefined
    if (raw && isErrorCodeToken(raw)) {
      return i18n.t(`errors:codes.${raw}` as never)
    }
    if (!raw && code && i18n.exists(`errors:codes.${code}`)) {
      return i18n.t(`errors:codes.${code}` as never)
    }
    return translateApiError({
      code,
      extra,
      message: raw,
      status,
      fallback,
    })
  }
  if (error instanceof Error) {
    const raw = error.message.trim()
    if (!raw) return fallback
    if (activeLocale() === 'zh-CN') return raw
    if (CJK_RE.test(raw)) return translateLegacyDbText(raw, fallback) ?? fallback
    return raw
  }
  return fallback
}
