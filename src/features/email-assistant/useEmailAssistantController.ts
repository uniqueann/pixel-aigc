import { useCallback, useEffect, useRef, useState } from 'react'
import { authEnabled } from '@/cloud/client'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { createTask, deleteTask, getTask, getTaskByRequest, listTasks, saveTaskEdit, type TaskSummary } from '@/services/api/task'
import { useTaskStore } from '@/store/useTaskStore'
import {
  Capability,
  type EmailAssistTaskParams,
  type GenerationTask,
  type TaskStatus,
} from '@/types'

const ACTIVE_STATUSES = new Set<TaskStatus>(['pending', 'queued', 'processing'])

function isEmailAssistTask(task: GenerationTask<unknown>): task is GenerationTask<EmailAssistTaskParams> {
  if (task.capability !== Capability.EmailAssist || !task.params || typeof task.params !== 'object') return false
  const params = task.params as Partial<EmailAssistTaskParams>
  return typeof params.sourceText === 'string'
    && typeof params.operation === 'string'
    && typeof params.language === 'string'
}

export function useEmailAssistantController() {
  const upsertTask = useTaskStore((state) => state.upsertTask)
  const [activeTaskId, setActiveTaskId] = useState<string>()
  const [task, setTask] = useState<GenerationTask<EmailAssistTaskParams>>()
  const [resultText, setResultText] = useState('')
  const [history, setHistory] = useState<TaskSummary[]>([])
  const [historyTotal, setHistoryTotal] = useState(0)
  const [historyPage, setHistoryPage] = useState(1)
  const [submitting, setSubmitting] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [submissionError, setSubmissionError] = useState<string>()
  const [protocolError, setProtocolError] = useState<string>()
  const handledVersionsRef = useRef(new Set<string>())
  const editTimerRef = useRef<ReturnType<typeof setTimeout>>()
  const pendingEditRef = useRef<{ taskId: string; text: string }>()
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
      setProtocolError('任务已完成，但接口没有返回邮件文本')
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
    if (!authEnabled) return
    queueMicrotask(() => {
      void refreshHistory().then(async items => {
        if (!touchedRef.current && items[0]) await openTask(items[0].id)
      }).catch(() => { /* 历史读取失败不阻止新任务。 */ })
    })
  }, [openTask, refreshHistory])

  const flushEdit = useCallback(async () => {
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
    const pending = pendingEditRef.current
    if (!pending) {
      try { await saveChainRef.current; return !pendingEditRef.current }
      catch { return false }
    }
    pendingEditRef.current = undefined
    setSavingEdit(true)
    try {
      saveChainRef.current = saveChainRef.current.catch(() => undefined).then(() => saveTaskEdit(pending.taskId, pending.text))
      await saveChainRef.current
      return true
    }
    catch (error) {
      if (!pendingEditRef.current) pendingEditRef.current = pending
      setSubmissionError(error instanceof Error ? `修改稿保存失败：${error.message}` : '修改稿保存失败')
      return false
    }
    finally { setSavingEdit(false) }
  }, [])

  const editResult = useCallback((value: string) => {
    setResultText(value)
    if (!authEnabled || task?.status !== 'succeeded') return
    pendingEditRef.current = { taskId: task.id, text: value }
    if (editTimerRef.current) clearTimeout(editTimerRef.current)
    editTimerRef.current = setTimeout(() => { void flushEdit() }, 600)
  }, [flushEdit, task])

  const newTask = useCallback(async () => {
    touchedRef.current = true
    if (!await flushEdit()) throw new Error('修改稿保存失败，请重试后新建任务')
    ++selectionEpochRef.current
    selectedTaskIdRef.current = undefined
    setTask(undefined)
    setActiveTaskId(undefined)
    setResultText('')
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [flushEdit])

  const generate = useCallback(async (params: EmailAssistTaskParams, modelProfileId?: string) => {
    touchedRef.current = true
    if (!await flushEdit()) throw new Error('修改稿保存失败，请重试后生成')
    const epoch = ++selectionEpochRef.current
    selectedTaskIdRef.current = undefined
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    setResultText('')
    const requestId = crypto.randomUUID()
    try {
      const nextTask = await createTask({
        capability: Capability.EmailAssist,
        params,
        requestId,
        modelProfileId,
      })
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
          if (epoch === selectionEpochRef.current) {
            selectedTaskIdRef.current = recovered.id
            handleTask(recovered)
          }
          await refreshHistory().catch(() => undefined)
          return recovered
        } catch { /* 任务尚未创建时显示原始错误。 */ }
      }
      const message = error instanceof Error ? error.message : '邮件任务提交失败'
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [flushEdit, handleTask, refreshHistory])

  const retry = useCallback(() => task ? generate(task.params, task.modelProfileId) : Promise.resolve(undefined), [generate, task])

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

  useEffect(() => () => { if (editTimerRef.current) clearTimeout(editTimerRef.current); void flushEdit() }, [flushEdit])

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
    formLocked: submitting || (!!status && ACTIVE_STATUSES.has(status)),
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
