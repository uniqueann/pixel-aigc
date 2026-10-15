// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import { useTaskStore } from '@/store/useTaskStore'
import { Capability, type GenerationTask } from '@/types'
import { useTaskPolling } from './useTaskPolling'
const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}))
vi.mock('@/services/api/task', () => ({ getTask: mocks.get }))
vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      notification: { success: mocks.success, error: mocks.error },
    }),
  },
}))
const owner = '00000000-0000-4000-8000-000000000081'
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 10000 } },
  })
  useUserStore.getState().setAccount({
    userId: owner,
    runtimeScope: 'preview',
    features: { taskCenter: true },
  } as AccountContext)
})
afterEach(() => {
  cleanup()
  client.clear()
  useTaskStore.getState().resetOwner(null)
  useUserStore.getState().setAccount(null)
})
const task = {
  id: 'task-one',
  capability: Capability.Variation,
  status: 'succeeded',
  params: {},
  result: {},
  creditsCost: 0,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
} as GenerationTask
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
)
describe('共享单任务轮询', () => {
  it('按服务端提示等到查询时间，完成后停止，多个观察者仍只发一次请求', async () => {
    vi.useFakeTimers()
    try {
      mocks.get.mockResolvedValueOnce({ ...task, status: 'processing', pollAfterMs: 3_000 }).mockResolvedValue(task)
      const consume = vi.fn()
      renderHook(() => { useTaskPolling(task.id, consume); useTaskPolling(task.id) }, { wrapper })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(mocks.get).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(2_999) })
      expect(mocks.get).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(1) })
      expect(mocks.get).toHaveBeenCalledTimes(2)
      await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
      expect(mocks.get).toHaveBeenCalledTimes(2)
      expect(consume).toHaveBeenCalledWith(task)
    } finally {
      cleanup()
      client.clear()
      await vi.runOnlyPendingTimersAsync()
      vi.useRealTimers()
    }
  })
  it('两个消费者复用一次查询，各自收到回调；缓存含账号与环境', async () => {
    mocks.get.mockResolvedValue(task)
    const first = vi.fn(),
      second = vi.fn()
    renderHook(
      () => {
        useTaskPolling(task.id, first)
        useTaskPolling(task.id, second)
      },
      { wrapper },
    )
    await waitFor(() => expect(first).toHaveBeenCalledWith(task))
    expect(second).toHaveBeenCalledWith(task)
    expect(mocks.get).toHaveBeenCalledTimes(1)
    expect(client.getQueryData(['task', owner, 'preview', task.id])).toEqual(
      task,
    )
    expect(mocks.success).not.toHaveBeenCalled()
  })
  it('网络取消信号传入原任务 API；切换账号后丢弃旧响应', async () => {
    let done!: (value: GenerationTask) => void
    const pending = new Promise<GenerationTask>((resolve) => {
      done = resolve
    })
    mocks.get.mockReturnValue(pending)
    const consume = vi.fn()
    renderHook(() => useTaskPolling(task.id, consume), { wrapper })
    await waitFor(() => expect(mocks.get).toHaveBeenCalled())
    const signal = mocks.get.mock.calls[0][1].signal as AbortSignal
    act(() => useUserStore.getState().setAccount(null))
    expect(signal.aborted).toBe(true)
    await act(async () => {
      done(task)
      await pending
    })
    expect(consume).not.toHaveBeenCalled()
    expect(useTaskStore.getState().tasks[task.id]).toBeUndefined()
  })
})
