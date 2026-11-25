import { EMAIL_PRICE_VERSION } from '@shared/email-models'
import { i18n } from '@/i18n'
import { translateApiError } from '@/i18n/apiErrors'
import { Capability, type EmailAssistTaskParams, type GenerationTask } from '@/types'
import type { CreateTaskPayload } from '@/services/api/task'
import { buildEmailAssistRequest } from '../requestBuilder'
import type { EmailBatchRow, EmailBatchState } from './types'

interface BatchPorts {
  submit: (request: CreateTaskPayload<EmailAssistTaskParams>, signal: AbortSignal) => Promise<GenerationTask<unknown>>
  find: (requestId: string) => Promise<GenerationTask<unknown> | undefined>
  get: (taskId: string) => Promise<GenerationTask<unknown>>
  acquire: () => boolean
  release: () => void
  wait?: () => Promise<void>
  onTask?: (task: GenerationTask<unknown>) => void
  onInvalidKey?: () => void
}

const ACTIVE = new Set(['pending', 'queued', 'processing'])
const PAUSE_CODES = new Set([
  'INSUFFICIENT_CREDITS', 'PRICE_CHANGED', 'CREDIT_ACCOUNT_REVIEW', 'MODEL_UNAVAILABLE', 'PROVIDER_AUTH', 'PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT',
  'INVALID_PROVIDER_KEY', 'PROVIDER_BALANCE', 'PROVIDER_RATE_LIMIT', 'RATE_LIMIT',
  'USER_CONCURRENCY', 'GLOBAL_CONCURRENCY', 'ACCOUNT_CHANGED', 'ACCOUNT_DISABLED',
  'AUTH_DISABLED', 'KEY_NOT_CONFIGURED', 'KEY_NOT_VERIFIED',
  'MODEL_KEY_REQUIRED', 'MODEL_KEY_INVALID', 'MEMBER_DISABLED', 'MEMBER_UNAVAILABLE',
])

function errorMessage(error: unknown) {
  const fallback = i18n.t('email:runner.errors.requestFailed')
  if (!error || typeof error !== 'object') return fallback
  const record = error as { code?: unknown; status?: unknown; extra?: unknown; requestId?: unknown; message?: unknown }
  return translateApiError({
    code: typeof record.code === 'string' ? record.code : undefined,
    status: typeof record.status === 'number' ? record.status : undefined,
    extra: record.extra && typeof record.extra === 'object' ? (record.extra as Record<string, unknown>) : undefined,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    message: error instanceof Error ? error.message : typeof record.message === 'string' ? record.message : undefined,
    fallback,
  })
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function taskFailureMessage(task: GenerationTask<unknown>) {
  const fallback = task.status === 'succeeded'
    ? i18n.t('email:runner.errors.missingResultText')
    : i18n.t('email:runner.errors.generateFailed')
  if (!task.errorMessage && !task.errorCode) return fallback
  return translateApiError({
    code: task.errorCode,
    message: task.errorMessage,
    requestId: task.requestId,
    fallback,
  })
}

/** 每个页面会话独立持有队列；销毁后禁止继续提交和写回迟到的响应。 */
export function createEmailBatchRunner(ports: BatchPorts) {
  let state: EmailBatchState = { rows: [], runState: 'idle', recovering: false }
  const listeners = new Set<() => void>()
  let disposed = false
  let working = false
  let pauseRequested = false
  let requestController = new AbortController()
  const wait = ports.wait ?? (() => new Promise<void>(resolve => window.setTimeout(resolve, 2000)))
  const unresolved = () => state.rows.some(row => row.status === 'uncertain')
  const pending = () => state.rows.some(row => row.status === 'pending')
  const publish = (patch: Partial<EmailBatchState>) => {
    if (disposed) return
    state = { ...state, ...patch }
    listeners.forEach(listener => listener())
  }
  const update = (id: string, patch: Partial<EmailBatchRow>) => {
    publish({ rows: state.rows.map(row => row.id === id ? { ...row, ...patch } : row) })
  }
  const stop = (message: string) => {
    pauseRequested = true
    publish({ runState: 'paused', pauseMessage: message })
  }
  const uncertain = (row: EmailBatchRow, message: string) => {
    update(row.id, { status: 'uncertain', errorMessage: message })
    stop(i18n.t('email:runner.pauseMessages.uncertain'))
  }

  async function completeTask(row: EmailBatchRow, received: GenerationTask<unknown>) {
    let task = received
    if (disposed) return
    update(row.id, { taskId: task.id, modelProfileId: task.modelProfileId, creditsCost: task.creditsCost, status: 'processing', errorMessage: undefined, errorCode: undefined })
    try {
      while (!disposed) {
        if (task.capability !== Capability.EmailAssist || !task.id) throw new Error(i18n.t('email:runner.errors.mismatchedTask'))
        ports.onTask?.(task)
        if (!ACTIVE.has(task.status)) break
        await wait()
        if (disposed) return
        task = await ports.get(task.id)
      }
    } catch (error) {
      if (!disposed && errorCode(error) === 'TASK_EXPIRED') update(row.id, { status: 'failed', requestId: undefined, taskId: undefined, creditsCost: undefined, errorCode: 'TASK_EXPIRED', errorMessage: i18n.t('email:runner.errors.taskExpired') })
      else if (!disposed) uncertain(row, i18n.t('email:runner.errors.pollFailed', { reason: errorMessage(error) }))
      return
    }
    if (disposed) return
    if (task.status === 'succeeded' && task.resultText?.trim()) {
      update(row.id, { status: 'succeeded', modelProfileId: task.modelProfileId, creditsCost: task.creditsCost, resultText: task.editedText ?? task.resultText, errorMessage: undefined, errorCode: undefined })
      return
    }
    const code = task.errorCode ?? 'RESULT_PROTOCOL'
    const message = taskFailureMessage(task)
    update(row.id, { status: 'failed', modelProfileId: task.modelProfileId, creditsCost: task.creditsCost, errorCode: code, errorMessage: message })
    if (code === 'INVALID_PROVIDER_KEY') ports.onInvalidKey?.()
    if (PAUSE_CODES.has(code)) stop(message)
  }

  async function submitRow(row: EmailBatchRow) {
    if (!row.params || disposed) return
    const requestId = row.requestId ?? crypto.randomUUID()
    update(row.id, { requestId, status: 'processing', errorMessage: undefined, errorCode: undefined })
    const currentRow = { ...row, requestId }
    let task: GenerationTask<unknown> | undefined
    try {
      // 曾提交过的请求先查询原任务；未创建时才用同一幂等键重新提交。
      if (row.requestId) task = await ports.find(requestId)
    } catch (error) {
      if (!disposed && errorCode(error) === 'TASK_EXPIRED') update(row.id, { status: 'failed', requestId: undefined, taskId: undefined, errorCode: 'TASK_EXPIRED', errorMessage: i18n.t('email:runner.errors.taskExpired') })
      else if (!disposed) uncertain(currentRow, i18n.t('email:runner.errors.findFailed', { reason: errorMessage(error) }))
      return
    }
    if (disposed) return
    if (!task) {
      try {
        task = await ports.submit({ ...buildEmailAssistRequest(row.params, requestId), modelProfileId: state.modelProfileId, priceVersion: state.priceVersion }, requestController.signal)
      } catch (error) {
        if (disposed) return
        try { task = await ports.find(requestId) }
        catch (recoveryError) {
          if (!disposed) {
            uncertain(currentRow, i18n.t('email:runner.errors.submitAndFindFailed', {
              submitReason: errorMessage(error),
              findReason: errorMessage(recoveryError),
            }))
          }
          return
        }
        if (disposed) return
        if (!task) {
          const code = errorCode(error)
          const message = errorMessage(error)
          if (['INVALID_PROVIDER_KEY', 'MODEL_KEY_INVALID', 'MODEL_KEY_REQUIRED'].includes(code ?? '')) ports.onInvalidKey?.()
          // 未创建的请求保留标识。网络错误和资源限制均暂停，避免连带失败整批。
          const hasHttpStatus = error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
          const pause = !hasHttpStatus || PAUSE_CODES.has(code ?? '') || (hasHttpStatus && Number(error.status) >= 500)
          update(row.id, { status: pause ? 'pending' : 'failed', errorCode: code, errorMessage: message })
          if (code === 'PRICE_CHANGED' || code === 'MODEL_UNAVAILABLE') ports.onInvalidKey?.()
          if (pause) stop(message)
          return
        }
      }
    }
    if (!disposed && task) await completeTask(currentRow, task)
  }

  async function run(modelProfileId: string, retryIds?: string[], priceVersion = EMAIL_PRICE_VERSION) {
    if (disposed || working || unresolved()) return
    const targets = state.rows.filter(row => retryIds ? retryIds.includes(row.id) && row.status === 'failed' : row.status === 'pending')
    if (!targets.length) return
    if (!ports.acquire()) {
      publish({ runState: 'paused', pauseMessage: i18n.t('email:runner.pauseMessages.gateBusy') })
      return
    }
    working = true
    pauseRequested = false
    if (retryIds) {
      publish({ rows: state.rows.map(row => targets.some(target => target.id === row.id)
        ? { ...row, status: 'pending', requestId: row.taskId ? undefined : row.requestId, taskId: undefined, errorCode: undefined, errorMessage: undefined, resultText: undefined, creditsCost: undefined }
        : row) })
    }
    publish({ runState: 'running', pauseMessage: undefined, modelProfileId: state.modelProfileId ?? modelProfileId, priceVersion })
    try {
      for (const target of targets) {
        if (disposed || pauseRequested) break
        const row = state.rows.find(item => item.id === target.id)
        if (row?.status === 'pending') await submitRow(row)
      }
    } finally {
      working = false
      if (!unresolved()) ports.release()
      if (!disposed) publish({
        runState: pauseRequested || pending() || unresolved() ? 'paused' : 'completed',
        ...(state.runState === 'pausing' ? { pauseMessage: i18n.t('email:runner.pauseMessages.paused') } : {}),
      })
    }
  }

  async function recover() {
    if (disposed || working || !unresolved() || !ports.acquire()) return
    working = true
    publish({ recovering: true, pauseMessage: undefined })
    try {
      for (const row of state.rows.filter(item => item.status === 'uncertain')) {
        if (disposed) break
        try {
          const task = row.taskId ? await ports.get(row.taskId) : await ports.find(row.requestId!)
          if (disposed) break
          if (task) await completeTask(row, task)
          else update(row.id, { status: 'pending', errorMessage: undefined, errorCode: undefined })
        } catch (error) {
          if (!disposed && errorCode(error) === 'TASK_EXPIRED') update(row.id, { status: 'failed', requestId: undefined, taskId: undefined, errorCode: 'TASK_EXPIRED', errorMessage: i18n.t('email:runner.errors.taskExpired') })
          else if (!disposed) uncertain(row, i18n.t('email:runner.errors.findFailed', { reason: errorMessage(error) }))
        }
      }
    } finally {
      working = false
      if (!unresolved()) ports.release()
      if (!disposed) publish({ recovering: false, runState: pending() || unresolved() ? 'paused' : 'completed' })
    }
  }

  return {
    activate: () => {
      disposed = false
      if (requestController.signal.aborted) requestController = new AbortController()
    },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    load: (rows: EmailBatchRow[], fileName?: string) => {
      if (disposed || working || unresolved()) throw new Error(i18n.t('email:runner.errors.loadBlocked'))
      publish({ rows, fileName, runState: 'idle', modelProfileId: undefined, priceVersion: undefined, pauseMessage: undefined })
    },
    start: (modelProfileId: string, priceVersion?: string) => run(modelProfileId, undefined, priceVersion),
    retry: (modelProfileId: string, ids = state.rows.filter(row => row.status === 'failed').map(row => row.id), priceVersion?: string) => run(modelProfileId, ids, priceVersion),
    pause: () => {
      if (!working || state.recovering) return
      pauseRequested = true
      publish({ runState: 'pausing', pauseMessage: i18n.t('email:runner.pauseMessages.pausing') })
    },
    recover,
    dispose: () => { disposed = true; pauseRequested = true; requestController.abort(); listeners.clear(); ports.release() },
  }
}
