// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskStore } from '@/store/useTaskStore'
import { Capability, type EmailAssistTaskParams, type GenerationTask } from '@/types'
import { useEmailAssistantController } from './useEmailAssistantController'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  authEnabled: false,
  getTaskByRequest: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  getTask: vi.fn(),
  polling: {
    data: undefined as GenerationTask<unknown> | undefined,
    error: null as Error | null,
    isFetching: false,
  },
  refetch: vi.fn(),
}))

vi.mock('@/cloud/client', () => ({ get authEnabled() { return mocks.authEnabled } }))
vi.mock('@/services/api/task', () => ({ createTask: mocks.createTask, getTask: mocks.getTask,
  getTaskByRequest: mocks.getTaskByRequest, listTasks: mocks.listTasks }))
vi.mock('@/hooks/useTaskPolling', async () => {
  const { useEffect: useReactEffect } = await import('react')
  return {
    useTaskPolling: (_taskId: string | undefined, onTask?: (task: GenerationTask<unknown>) => void) => {
      const polledTask = mocks.polling.data
      useReactEffect(() => {
        if (polledTask) onTask?.(polledTask)
      }, [onTask, polledTask])
      return { ...mocks.polling, refetch: mocks.refetch }
    },
  }
})

type Controller = ReturnType<typeof useEmailAssistantController>
let controller: Controller

function Harness() {
  const current = useEmailAssistantController()
  useEffect(() => {
    controller = current
  }, [current])
  return null
}

describe('useEmailAssistantController', () => {
  it('代理失败且暂未查到任务时锁定原请求，同标识恢复只显示一次扣费', async () => {
    mocks.authEnabled = true
    const missing = Object.assign(new Error('尚未找到'), { status: 404 })
    mocks.getTaskByRequest.mockRejectedValue(missing)
    mocks.createTask.mockRejectedValueOnce(Object.assign(new Error('代理超时'), { status: 502 }))
    const params: EmailAssistTaskParams = { sourceText: '客户邮件', operation: 'reply', language: 'en-US' }
    await act(async () => { await expect(controller.generate(params, 'ai-gateway:gemini-3.8-flash', 'aigc-email-v1')).rejects.toThrow('代理超时') })
    expect(controller.uncertain).toBe(true)
    expect(controller.formLocked).toBe(true)
    await expect(controller.newTask()).rejects.toThrow('确认原请求')
    const original = mocks.createTask.mock.calls[0][0]
    mocks.createTask.mockResolvedValueOnce({ id: '恢复任务', capability: Capability.EmailAssist, status: 'succeeded', params,
      resultText: '完整回复', creditsCost: 3, modelProfileId: original.modelProfileId, createdAt: '2026-10-09', updatedAt: '2026-10-09' })
    await act(async () => { await controller.recoverSubmission() })
    expect(mocks.createTask.mock.calls[1][0]).toEqual(original)
    expect(controller.uncertain).toBe(false)
    expect(controller.task?.creditsCost).toBe(3)
  })

  it('明确余额不足且查询证实未创建时解除锁定', async () => {
    mocks.authEnabled = true
    mocks.getTaskByRequest.mockRejectedValue(Object.assign(new Error('未创建'), { status: 404 }))
    mocks.createTask.mockRejectedValueOnce(Object.assign(new Error('积分不足'), { status: 402, code: 'INSUFFICIENT_CREDITS' }))
    await act(async () => { await expect(controller.generate({ sourceText: '客户邮件', operation: 'reply', language: 'zh' }, 'deepseek:deepseek-flash')).rejects.toThrow('积分不足') })
    expect(controller.uncertain).toBe(false)
    expect(controller.formLocked).toBe(false)
    await act(async () => { await controller.newTask() })
  })

  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    mocks.authEnabled = false
    mocks.getTaskByRequest.mockReset()
    mocks.listTasks.mockResolvedValue({ items: [], total: 0 })
    mocks.createTask.mockReset()
    mocks.polling.data = undefined
    mocks.polling.error = null
    mocks.refetch.mockReset()
    useTaskStore.setState({ tasks: {} })
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => root.render(<Harness />))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('新建任务不会被迟到的历史读取重新填充', async () => {
    let resolveHistory!: (task: GenerationTask<EmailAssistTaskParams>) => void
    mocks.getTask.mockReturnValue(new Promise(resolve => { resolveHistory = resolve }))
    let opening!: Promise<unknown>
    await act(async () => { opening = controller.openTask('old-email') })
    await act(async () => { await controller.newTask() })
    await act(async () => {
      resolveHistory({ id: 'old-email', capability: Capability.EmailAssist, status: 'succeeded', params: { sourceText: '旧邮件', operation: 'reply', language: 'zh' }, resultText: '旧结果', creditsCost: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' })
      await opening
    })
    expect(controller.task).toBeUndefined()
    expect(controller.resultText).toBe('')
  })

  it('新建任务保留历史，之后仍可重新打开同一任务', async () => {
    const task: GenerationTask<EmailAssistTaskParams> = { id: 'saved-email', capability: Capability.EmailAssist, status: 'succeeded', params: { sourceText: '历史邮件', operation: 'reply', language: 'zh' }, resultText: '回复结果', creditsCost: 1, createdAt: '2026-10-01', updatedAt: '2026-10-01' }
    mocks.getTask.mockResolvedValue(task)
    await act(async () => { await controller.openTask(task.id) })
    await act(async () => { await controller.newTask() })
    expect(controller.resultText).toBe('')
    expect(useTaskStore.getState().tasks[task.id].resultText).toBe('回复结果')
    await act(async () => { await controller.openTask(task.id) })
    expect(controller.resultText).toBe('回复结果')
  })

  it('提交、轮询并允许编辑单条文本结果', async () => {
    const processingTask: GenerationTask<EmailAssistTaskParams> = {
      id: 'email-task',
      capability: Capability.EmailAssist,
      status: 'processing',
      params: { sourceText: '客户邮件', operation: 'reply', language: 'zh' },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(processingTask)

    await act(async () => {
      await controller.generate(processingTask.params)
    })
    expect(controller.formLocked).toBe(true)

    mocks.polling.data = {
      ...processingTask,
      status: 'succeeded',
      resultText: '建议回复内容',
      updatedAt: '2026-09-07T00:01:00.000Z',
    }
    await act(async () => root.render(<Harness />))
    expect(controller.resultText).toBe('建议回复内容')

    await act(async () => controller.setResultText('用户修改后的内容'))
    expect(controller.resultText).toBe('用户修改后的内容')
    expect(useTaskStore.getState().tasks['email-task'].status).toBe('succeeded')
  })

  it('成功任务缺少文本时报告协议错误', async () => {
    const succeededTask: GenerationTask<EmailAssistTaskParams> = {
      id: 'email-empty',
      capability: Capability.EmailAssist,
      status: 'succeeded',
      params: { sourceText: '客户邮件', operation: 'summarize', language: 'zh' },
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    mocks.createTask.mockResolvedValue(succeededTask)
    await act(async () => {
      await controller.generate(succeededTask.params)
    })
    expect(controller.protocolError).toBe('任务已完成，但接口没有返回邮件文本')
  })

  it('失败后按参数快照创建新的重试任务', async () => {
    const failedTask: GenerationTask<EmailAssistTaskParams> = {
      id: 'email-failed',
      capability: Capability.EmailAssist,
      status: 'failed',
      params: { sourceText: '客户邮件', operation: 'reply', language: 'zh' },
      errorMessage: '模拟失败',
      creditsCost: 1,
      createdAt: '2026-09-07T00:00:00.000Z',
      updatedAt: '2026-09-07T00:00:00.000Z',
    }
    const retryTask = { ...failedTask, id: 'email-retry', status: 'processing' as const }
    mocks.createTask.mockResolvedValueOnce(failedTask).mockResolvedValueOnce(retryTask)

    await act(async () => {
      await controller.generate(failedTask.params)
    })
    await act(async () => {
      await controller.retry()
    })

    expect(mocks.createTask).toHaveBeenCalledTimes(2)
    expect(mocks.createTask.mock.calls[1][0].params).toEqual(failedTask.params)
    expect(controller.task?.id).toBe('email-retry')
  })
})
