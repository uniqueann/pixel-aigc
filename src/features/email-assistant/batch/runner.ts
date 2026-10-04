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
  'INVALID_PROVIDER_KEY', 'PROVIDER_BALANCE', 'PROVIDER_RATE_LIMIT', 'RATE_LIMIT',
  'USER_CONCURRENCY', 'GLOBAL_CONCURRENCY', 'ACCOUNT_CHANGED', 'ACCOUNT_DISABLED',
  'AUTH_DISABLED', 'KEY_NOT_CONFIGURED', 'KEY_NOT_VERIFIED',
  'MODEL_KEY_REQUIRED', 'MODEL_KEY_INVALID', 'MEMBER_DISABLED', 'MEMBER_UNAVAILABLE',
])

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '邮件任务请求失败，请稍后重试'
}

function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : undefined
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
    stop('原任务状态尚未确认，请重新查询后继续，避免重复生成。')
  }

  async function completeTask(row: EmailBatchRow, received: GenerationTask<unknown>) {
    let task = received
    if (disposed) return
    update(row.id, { taskId: task.id, status: 'processing', errorMessage: undefined, errorCode: undefined })
    try {
      while (!disposed) {
        if (task.capability !== Capability.EmailAssist || !task.id) throw new Error('接口返回了不匹配的邮件任务')
        ports.onTask?.(task)
        if (!ACTIVE.has(task.status)) break
        await wait()
        if (disposed) return
        task = await ports.get(task.id)
      }
    } catch (error) {
      if (!disposed) uncertain(row, `任务查询失败：${errorMessage(error)}`)
      return
    }
    if (disposed) return
    if (task.status === 'succeeded' && task.resultText?.trim()) {
      update(row.id, { status: 'succeeded', resultText: task.editedText ?? task.resultText, errorMessage: undefined, errorCode: undefined })
      return
    }
    const code = task.errorCode ?? 'RESULT_PROTOCOL'
    const message = task.errorMessage ?? (task.status === 'succeeded' ? '任务已完成，但接口没有返回邮件文本' : '邮件生成失败，请重试')
    update(row.id, { status: 'failed', errorCode: code, errorMessage: message })
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
      if (!disposed) uncertain(currentRow, `原请求查询失败：${errorMessage(error)}`)
      return
    }
    if (disposed) return
    if (!task) {
      try {
        task = await ports.submit({ ...buildEmailAssistRequest(row.params, requestId), modelProfileId: state.modelProfileId }, requestController.signal)
      } catch (error) {
        if (disposed) return
        try { task = await ports.find(requestId) }
        catch (recoveryError) {
          if (!disposed) uncertain(currentRow, `${errorMessage(error)}；原请求查询失败：${errorMessage(recoveryError)}`)
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
          if (pause) stop(message)
          return
        }
      }
    }
    if (!disposed && task) await completeTask(currentRow, task)
  }

  async function run(modelProfileId: string, retryIds?: string[]) {
    if (disposed || working || unresolved()) return
    const targets = state.rows.filter(row => retryIds ? retryIds.includes(row.id) && row.status === 'failed' : row.status === 'pending')
    if (!targets.length) return
    if (!ports.acquire()) {
      publish({ runState: 'paused', pauseMessage: '当前有邮件正在处理，请完成后再开始批量生成。' })
      return
    }
    working = true
    pauseRequested = false
    if (retryIds) {
      publish({ rows: state.rows.map(row => targets.some(target => target.id === row.id)
        ? { ...row, status: 'pending', requestId: row.taskId ? undefined : row.requestId, taskId: undefined, errorCode: undefined, errorMessage: undefined, resultText: undefined }
        : row) })
    }
    publish({ runState: 'running', pauseMessage: undefined, modelProfileId: state.modelProfileId ?? modelProfileId })
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
        ...(state.runState === 'pausing' ? { pauseMessage: '已暂停，成功结果已保留，可继续待处理邮件。' } : {}),
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
          if (!disposed) uncertain(row, `原请求查询失败：${errorMessage(error)}`)
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
      if (disposed || working || unresolved()) throw new Error('请先等待当前任务完成或重新查询，再替换 CSV')
      publish({ rows, fileName, runState: 'idle', modelProfileId: undefined, pauseMessage: undefined })
    },
    start: (modelProfileId: string) => run(modelProfileId),
    retry: (modelProfileId: string, ids = state.rows.filter(row => row.status === 'failed').map(row => row.id)) => run(modelProfileId, ids),
    pause: () => {
      if (!working || state.recovering) return
      pauseRequested = true
      publish({ runState: 'pausing', pauseMessage: '正在等待当前邮件完成，之后暂停后续提交…' })
    },
    recover,
    dispose: () => { disposed = true; pauseRequested = true; requestController.abort(); listeners.clear(); ports.release() },
  }
}
