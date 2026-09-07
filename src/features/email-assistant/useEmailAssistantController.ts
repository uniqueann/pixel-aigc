import { useCallback, useRef, useState } from 'react'
import { useTaskPolling } from '@/hooks/useTaskPolling'
import { createTask } from '@/services/api/task'
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
  const [submitting, setSubmitting] = useState(false)
  const [submissionError, setSubmissionError] = useState<string>()
  const [protocolError, setProtocolError] = useState<string>()
  const handledVersionsRef = useRef(new Set<string>())

  const handleTask = useCallback((nextTask: GenerationTask<unknown>) => {
    if (!isEmailAssistTask(nextTask)) return
    const version = `${nextTask.id}:${nextTask.status}:${nextTask.updatedAt}`
    if (handledVersionsRef.current.has(version)) return
    handledVersionsRef.current.add(version)
    setTask(nextTask)
    upsertTask(nextTask)
    if (nextTask.status !== 'succeeded') return
    if (!nextTask.resultText?.trim()) {
      setProtocolError('任务已完成，但接口没有返回邮件文本')
      setResultText('')
      return
    }
    setResultText(nextTask.resultText)
    setProtocolError(undefined)
  }, [upsertTask])

  const taskQuery = useTaskPolling(activeTaskId, handleTask)

  const generate = useCallback(async (params: EmailAssistTaskParams) => {
    setSubmitting(true)
    setSubmissionError(undefined)
    setProtocolError(undefined)
    try {
      const nextTask = await createTask({
        capability: Capability.EmailAssist,
        params,
        requestId: crypto.randomUUID(),
      })
      setTask(nextTask)
      upsertTask(nextTask)
      setActiveTaskId(nextTask.id)
      handleTask(nextTask as GenerationTask<unknown>)
      return nextTask
    } catch (error) {
      const message = error instanceof Error ? error.message : '邮件任务提交失败'
      setSubmissionError(message)
      throw error
    } finally {
      setSubmitting(false)
    }
  }, [handleTask, upsertTask])

  const retry = useCallback(() => task ? generate(task.params) : Promise.resolve(undefined), [generate, task])

  const modifyParameters = useCallback(() => {
    setTask(undefined)
    setActiveTaskId(undefined)
    setSubmissionError(undefined)
    setProtocolError(undefined)
  }, [])

  const status = task?.status
  return {
    task,
    resultText,
    submitting,
    active: !!status && ACTIVE_STATUSES.has(status),
    formLocked: !!status && ACTIVE_STATUSES.has(status),
    submissionError,
    protocolError,
    pollError: taskQuery.error,
    polling: taskQuery.isFetching,
    setResultText,
    generate,
    retry,
    modifyParameters,
    refetch: taskQuery.refetch,
  }
}
