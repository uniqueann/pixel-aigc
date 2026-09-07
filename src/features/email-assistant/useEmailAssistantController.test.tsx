// @vitest-environment jsdom

import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useTaskStore } from '@/store/useTaskStore'
import { Capability, type EmailAssistTaskParams, type GenerationTask } from '@/types'
import { useEmailAssistantController } from './useEmailAssistantController'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const mocks = vi.hoisted(() => ({
  createTask: vi.fn(),
  polling: {
    data: undefined as GenerationTask<unknown> | undefined,
    error: null as Error | null,
    isFetching: false,
  },
  refetch: vi.fn(),
}))

vi.mock('@/services/api/task', () => ({ createTask: mocks.createTask }))
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
  let container: HTMLDivElement
  let root: Root

  beforeEach(async () => {
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
