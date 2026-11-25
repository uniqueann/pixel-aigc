import { useCallback, useEffect, useRef, useState } from 'react'
import { EMAIL_PRICE_VERSION } from '@shared/email-models'
import { i18n } from '@/i18n'
import { translateApiError } from '@/i18n/apiErrors'
import type { CreateTaskPayload } from '@/services/api/task'
import { authEnabled } from '@/cloud/client'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { createTask, deleteTask, getTask, getTaskByRequest, listTasks, saveTaskEdit, type TaskSummary } from '@/services/api/task'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import {
  Capability,
  type EmailAssistTaskParams,
  type GenerationTask,
  type TaskStatus,
} from '@/types'

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

function formatControllerError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback
  const record = error as Error & {
    code?: unknown
    status?: unknown
    extra?: unknown
    requestId?: unknown
  }
  return translateApiError({
    code: typeof record.code === 'string' ? record.code : undefined,
    status: typeof record.status === 'number' ? record.status : undefined,
    extra: record.extra && typeof record.extra === 'object' ? (record.extra as Record<string, unknown>) : undefined,
    requestId: typeof record.requestId === 'string' ? record.requestId : undefined,
    message: error.message,
    fallback,
  })
}

function isEmailAssistTask(task: GenerationTask<unknown>): task is GenerationTask<EmailAssistTaskParams> {
  if (task.capability !== Capability.EmailAssist || !task.params || typeof task.params !== 'object') return false
  const params = task.params as Partial<EmailAssistTaskParams>
  return typeof params.sourceText === 'string'
    && typeof params.operation === 'string'
    && typeof params.language === 'string'
}

export function useEmailAssistantController(options?: { autoRestoreLatest?: boolean; readOnlyRecovery?: boolean }) {
  const [sessionActor]=useState(()=>{const state=useUserStore.getState();return {owner:state.userId,scope:state.account?.runtimeScope}})
  const [autoRestoreLatest] = useState(() => options?.autoRestoreLatest ?? true)
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [task, setTask] = useState<GenerationTask<EmailAssistTaskParams>>()
  const [resultText, setResultText] = useState('')
  const [history, setHistory] = useState<TaskSummary[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const pendingRequestRef = useRef<CreateTaskPayload<EmailAssistTaskParams>>()
  const [uncertain, setUncertain] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [submissionError, setSubmissionError] = useState<string>()
  const [protocolError, setProtocolError] = useState<string>()
  const handledVersionsRef = useRef(new Set<string>())
  const editTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const pendingEditRef = useRef<{ taskId: string; text: string; owner:string|null;scope:import('@shared/task-center').TaskScope|undefined }>()
  const saveChainRef = useRef<Promise<unknown>>(Promise.resolve())
  const touchedRef = useRef(false)
  const selectionEpochRef = useRef(0)
  const selectedTaskIdRef = useRef<string>()

  const handleTask = useCallback((nextTask: GenerationTask<unknown>) => {
    if (!isEmailAssistTask(nextTask)) return
    const version = `${nextTask.id}:${nextTask.status}:${nextTask.updatedAt}`
    if (handledVersionsRef.current.has(version)) return
    handledVersionsRef.current.add(version)
    setTask(nextTask)
    upsertTask(nextTask)
    setActiveTaskId(ACTIVE_STATUSES.has(nextTask.status) ? nextTask.id : undefined)
    if (nextTask.status !== 'succeeded') { setResultText(''); return }
    if (!nextTask.resultText?.trim()) {
      setProtocolError(i18n.t('email:controller.missingResultText'))
      setResultText('')
      return
    }
    if (pendingEditRef.current?.taskId !== nextTask.id) setResultText(nextTask.editedText ?? nextTask.resultText)
    setProtocolError(undefined)
  }, [upsertTask])

  const handlePolledTask = useCallback((nextTask: GenerationTask<unknown>) => {
    if (selectedTaskIdRef.current === nextTask.id) handleTask(nextTask)
  }, [handleTask])
  const taskQuery = useTaskPolling(activeTaskId, handlePolledTask)

  const refreshHistory = useCallback(async () => {
    if (!authEnabled) return []
    const response = await listTasks({ capability: Capability.EmailAssist, page: 1 })
    setHistory(response.items)
    setHistoryTotal(response.total)
    setHistoryPage(1)
    return response.items
  }, [])

  const loadMoreHistory = useCallback(async () => {
    const nextPage = historyPage + 1
    const response = await listTasks({ capability: Capability.EmailAssist, page: nextPage })
    setHistory(previous => [...previous, ...response.items.filter(item => !previous.some(existing => existing.id === item.id))])
    setHistoryTotal(response.total)
    setHistoryPage(nextPage)
  }, [historyPage])

  const openTask = useCallback(async (id: string) => {
    touchedRef.current = true
    const epoch = ++selectionEpochRef.current
    selectedTaskIdRef.current = id
    handledVersionsRef.current.clear()
    const nextTask = await getTask(id)
    if (epoch === selectionEpochRef.current) handleTask(nextTask)
    return nextTask
  }, [handleTask])

  useEffect(() => {
    if (!authEnabled || options?.readOnlyRecovery) return
    let active = true
    queueMicrotask(() => {
      if (!active) return
      void refreshHistory().then(async items => {
        if (active && autoRestoreLatest && !touchedRef.current && items[0]) await openTask(items[0].id)
      }).catch(() => { /* 历史读取失败不阻止新任务。 */ })
    })
    return () => { active = false }
  }, [autoRestoreLatest, openTask, refreshHistory,options?.readOnlyRecovery])

  const flushEdit = useCallback(async () => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
    const pending = pendingEditRef.current
    if (!pending) {
      try { await saveChainRef.current; return !pendingEditRef.current }
      catch { return false }
    }
    const current=()=>{const state=useUserStore.getState();return state.userId===pending.owner&&state.account?.runtimeScope===pending.scope}
    if(!current()){pendingEditRef.current=undefined;return false}
    pendingEditRef.current = undefined
    setSavingEdit(true)
    try {
      saveChainRef.current = saveChainRef.current.catch(() => undefined).then(() => {
        if(!current())throw new DOMException(i18n.t('email:controller.accountOrScopeChanged'),'AbortError')
        return saveTaskEdit(pending.taskId,pending.text)
      })
      await saveChainRef.current
      return current()
    }
    catch (error) {
      if (current()&&!pendingEditRef.current) pendingEditRef.current = pending
      const reason = error instanceof Error
        ? formatControllerError(error, i18n.t('email:controller.saveEditFailed'))
        : undefined
      setSubmissionError(reason ? i18n.t('email:controller.saveEditFailedWithReason', { reason }) : i18n.t('email:controller.saveEditFailed'))
      return false
    }
    finally { setSavingEdit(false) }
  }, [])

  const editResult = useCallback((value: string) => {
    setResultText(value)
    if (!authEnabled || task?.status !== 'succeeded') return
    pendingEditRef.current = { taskId: task.id, text: value,...sessionActor }
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
    editTimerRef.current = setTimeout(() => { void flushEdit() }, 600)
  }, [flushEdit, task,sessionActor])

  const newTask = useCallback(async () => {
    if (pendingRequestRef.current) throw new Error(i18n.t('email:controller.confirmPendingRequest'))
    touchedRef.current = true
    if (!await flushEdit()) throw new Error(i18n.t('email:controller.saveEditBeforeNewTask'))
    ++selectionEpochRef.current
    selectedTaskIdRef.current = undefined
    setTask(undefined)
    setActiveTaskId(undefined)
    setResultText('')
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [flushEdit])

  const generate = useCallback(async (params: EmailAssistTaskParams, modelProfileId?: string, priceVersion?: string) => {
    touchedRef.current = true
    if (!await flushEdit()) throw new Error(i18n.t('email:controller.saveEditBeforeGenerate'))
    const epoch = ++selectionEpochRef.current
    selectedTaskIdRef.current = undefined
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    setResultText('')
    const payload = pendingRequestRef.current ?? { capability: Capability.EmailAssist, params,
      requestId: crypto.randomUUID(), modelProfileId, priceVersion: priceVersion ?? EMAIL_PRICE_VERSION }
    pendingRequestRef.current = payload
    const requestId = payload.requestId
    try {
      const nextTask = await createTask(payload)
      pendingRequestRef.current = undefined
      setUncertain(false)
      if (epoch === selectionEpochRef.current) {
        selectedTaskIdRef.current = nextTask.id
        handleTask(nextTask as GenerationTask<unknown>)
      }
      await refreshHistory().catch(() => undefined)
      return nextTask
    } catch (error) {
      if (authEnabled) {
        try {
          const recovered = await getTaskByRequest(requestId)
          pendingRequestRef.current = undefined
          setUncertain(false)
          if (epoch === selectionEpochRef.current) {
            selectedTaskIdRef.current = recovered.id
            handleTask(recovered)
          }
          await refreshHistory().catch(() => undefined)
          return recovered
        } catch (recoveryError) {
          const status = recoveryError && typeof recoveryError === 'object' && 'status' in recoveryError ? recoveryError.status : undefined
          if (status === 410) { pendingRequestRef.current = undefined; setUncertain(false) }
          else if (status === 404 && error && typeof error === 'object' && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500 && error.status !== 408) {
            pendingRequestRef.current = undefined; setUncertain(false)
          } else setUncertain(true)
        }
      }
      if (!authEnabled) pendingRequestRef.current = undefined
      if (error && typeof error === 'object' && 'code' in error && ['PRICE_CHANGED','MODEL_UNAVAILABLE'].includes(String(error.code)))
        window.dispatchEvent(new Event('pixel:model-settings-changed'))
      const message = formatControllerError(error, i18n.t('email:controller.submitFailed'))
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [flushEdit, handleTask, refreshHistory])

  const recoverSubmission = useCallback(async () => {
    const payload = pendingRequestRef.current
    if (!payload) return
    setSubmitting(true)
    try {
      let recovered: GenerationTask<unknown>
      try { recovered = await getTaskByRequest(payload.requestId) }
      catch (error) {
        if (error && typeof error === 'object' && 'status' in error && error.status === 404) {
          await generate(payload.params, payload.modelProfileId, payload.priceVersion)
          return
        }
        if (error && typeof error === 'object' && 'status' in error && error.status === 410) {
          pendingRequestRef.current = undefined; setUncertain(false)
        }
        throw error
      }
      pendingRequestRef.current = undefined; setUncertain(false)
      selectedTaskIdRef.current = recovered.id; handleTask(recovered)
      setSubmissionError(undefined)
      await refreshHistory().catch(() => undefined)
    } finally { setSubmitting(false) }
  }, [generate, handleTask, refreshHistory])

  const retry = useCallback((priceVersion?: string) => task ? generate(task.params, task.modelProfileId, priceVersion) : Promise.resolve(undefined), [generate, task])

  const modifyParameters = useCallback(() => {
    ++selectionEpochRef.current
    selectedTaskIdRef.current = undefined
    void flushEdit()
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [flushEdit])

  const removeTask = useCallback(async (id: string) => {
    await flushEdit()
    await deleteTask(id)
    if (task?.id === id) { setTask(undefined); setResultText(''); setActiveTaskId(undefined) }
    await refreshHistory()
  }, [flushEdit, refreshHistory, task?.id])

  useEffect(() => () => {
    ++selectionEpochRef.current
    selectedTaskIdRef.current = undefined
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
    void flushEdit()
  }, [flushEdit])

  const status = task?.status
  return {
    newTask,
    task,
    resultText,
    history,
    historyTotal,
    submitting,
    savingEdit,
    active: !!status && ACTIVE_STATUSES.has(status),
    uncertain, recoverSubmission,
    formLocked: uncertain || submitting || (!!status && ACTIVE_STATUSES.has(status)),
    submissionError,
    protocolError,
    pollError: taskQuery.error,
    polling: taskQuery.isFetching,
    setResultText: editResult,
    flushEdit,
    generate,
    retry,
    modifyParameters,
    openTask,
    removeTask,
    refreshHistory,
    loadMoreHistory,
    refetch: taskQuery.refetch,
  }
}
