// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import {
  QueryClient,
  QueryClientProvider,
  onlineManager,
  useQuery,
} from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import { CloudError } from '@/cloud/client'
import { TaskCenterProvider } from './TaskCenterRuntime'
import { useTaskCenter } from './context'
import { emitTaskCenter, readReceipts, saveReceipt } from './receipts'
import { taskCenterKeys } from './client'
import type { TaskCenterSummary } from '@shared/task-center'
import type { ReactNode } from 'react'

const api = vi.hoisted(() => ({
  request: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  destroy: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/cloud/client', () => ({
  CloudError: class extends Error {
    constructor(
      public status: number,
      message: string,
      public code: string,
    ) {
      super(message)
    }
  },
  cloudRequest: api.request,
}))
vi.mock('antd', () => ({
  App: {
    useApp: () => ({
      notification: {
        success: api.success,
        error: api.error,
        destroy: api.destroy,
      },
      message: { warning: api.warning },
    }),
  },
}))
vi.mock('./TaskCenterDrawer', () => ({ TaskCenterDrawer: () => null }))
const owner = '00000000-0000-4000-8000-000000000081',
  other = '00000000-0000-4000-8000-000000000082'
const actor = { owner, scope: 'preview' as const }
function login(
  id = owner,
  scope: AccountContext['runtimeScope'] = 'preview',
  enabled = true,
) {
  useUserStore.getState().setAccount({
    userId: id,
    runtimeScope: scope,
    features: { taskCenter: enabled },
  } as AccountContext)
}
function row(
  index = 1,
  state: TaskCenterSummary['state'] = 'processing',
): TaskCenterSummary {
  return {
    sourceKind: 'image_job',
    sourceId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    taskKey: `image_job:00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    requestId: `00000000-0000-4000-8001-${String(index).padStart(12, '0')}`,
    tool: 'variation',
    capability: 'variation',
    modelProfileId: 'mock',
    state,
    requestedCount: 2,
    completedCount: state === 'succeeded' ? 1 : 0,
    partial: state === 'succeeded',
    errorCode: null,
    warnings: [],
    origin: null,
    billingState: 'reserved',
    creditsReserved: 4,
    creditsCharged: null,
    creditsReturned: null,
    resultAvailability: 'pending',
    resultExpiresAt: null,
    taskExpiresAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
    outcomeVersion: state === 'processing' ? null : 'v1:' + 'a'.repeat(32),
    seen: false,
    dismissed: false,
  }
}
function Probe() {
  const center = useTaskCenter()
  return (
    <div>
      <span>{center?.error ? '查询暂不可用' : '正常'}</span>
      <span>
        {center?.sidebar?.items.map((r) => r.sourceId).join(',') ?? '无任务'}
      </span>
      <span>{center?.receipts.length ?? 0} 条待确认</span>
      <span>{center?.open ? '已打开' : '已关闭'}</span>
      <button onClick={() => center?.refresh()}>刷新</button>
      <button onClick={() => center?.show(center.sidebar?.items[0])}>
        打开
      </button>
    </div>
  )
}
let client: QueryClient
function mount(extra?: ReactNode) {
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return render(
    <QueryClientProvider client={client}>
      <TaskCenterProvider onCredits={() => undefined}>
        <Probe />
        {extra}
      </TaskCenterProvider>
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  login()
})
afterEach(() => {
  cleanup()
  onlineManager.setOnline(true)
  client?.clear()
  useUserStore.getState().setAccount(null)
})

describe('全局任务运行层', () => {
  it('初次加载不通知历史；本会话终态和迟到版本只各通知一次', async () => {
    let task = row(1, 'succeeded')
    api.request.mockImplementation(async () => ({
      items: [task],
      activeCount: task.state === 'processing' ? 1 : 0,
      unseenCount: 1,
      snapshotAt: new Date().toISOString(),
    }))
    mount()
    await waitFor(() => expect(screen.getByText(task.sourceId)).toBeTruthy())
    expect(api.success).not.toHaveBeenCalled()
    task = row(1)
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() =>
      expect(
        client.getQueryData<{ items: TaskCenterSummary[] }>(
          taskCenterKeys.sidebar(actor),
        )?.items[0].state,
      ).toBe('processing'),
    )
    task = row(1, 'succeeded')
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(api.success).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(4))
    expect(api.success).toHaveBeenCalledTimes(1)
    task = {
      ...task,
      outcomeVersion: 'v1:' + 'b'.repeat(32),
      completedCount: 2,
      partial: false,
    }
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(api.success).toHaveBeenCalledTimes(2))
  })
  it('超过五条可见任务时按原请求观察，并限制读取并发为二', async () => {
    const waiting = row(10),
      pending = row(11),
      third = row(12)
    let running = 0,
      maximum = 0
    api.request.mockImplementation(async (path: string) => {
      if (path.includes('by-request')) {
        running++
        maximum = Math.max(maximum, running)
        await new Promise((resolve) => setTimeout(resolve, 15))
        running--
        return path.endsWith(waiting.requestId)
          ? { ...waiting, ...row(10, 'succeeded') }
          : path.endsWith(pending.requestId)
            ? row(11, 'succeeded')
            : row(12, 'succeeded')
      }
      return {
        items: [1, 2, 3, 4, 5].map((i) => row(i)),
        activeCount: 8,
        unseenCount: 0,
        snapshotAt: new Date().toISOString(),
      }
    })
    mount()
    await waitFor(() => expect(api.request).toHaveBeenCalled())
    act(() => {
      ;[waiting, pending, third].forEach((task) =>
        saveReceipt('image_job', task.requestId),
      )
    })
    await waitFor(() => expect(api.success).toHaveBeenCalledTimes(3))
    expect(maximum).toBe(2)
    expect(readReceipts(actor)).toEqual([])
  })
  it('404 和断网保留待确认，不发生成 POST；关闭开关停止查询', async () => {
    saveReceipt('sync_credit', row().requestId)
    api.request.mockImplementation(async (path: string) => {
      if (path.includes('by-request'))
        throw new CloudError(404, '未知', 'TASK_NOT_FOUND')
      return {
        items: [],
        activeCount: 0,
        unseenCount: 0,
        snapshotAt: new Date().toISOString(),
      }
    })
    mount()
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2))
    expect(readReceipts(actor)).toHaveLength(1)
    expect(api.request.mock.calls.every((call) => call[1] === 'GET')).toBe(true)
    act(() => login(owner, 'preview', false))
    fireEvent.click(screen.getByText('刷新'))
    const count = api.request.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(api.request).toHaveBeenCalledTimes(count)
  })
  it('账号切换关闭抽屉、清缓存，A 的迟到响应不会进入 B', async () => {
    let complete!: (value: unknown) => void
    const deferred = new Promise((resolve) => {
      complete = resolve
    })
    api.request.mockImplementation(
      (
        _path: string,
        _method: string,
        _body: unknown,
        options: { expectedUserId: string },
      ) =>
        options.expectedUserId === owner
          ? deferred
          : Promise.resolve({
              items: [row(2)],
              activeCount: 1,
              unseenCount: 0,
              snapshotAt: new Date().toISOString(),
            }),
    )
    mount()
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByText('打开'))
    expect(screen.getByText('已打开')).toBeTruthy()
    act(() => login(other))
    await waitFor(() => expect(screen.getByText(row(2).sourceId)).toBeTruthy())
    expect(screen.getByText('已关闭')).toBeTruthy()
    await act(async () => {
      complete({
        items: [row(1)],
        activeCount: 1,
        unseenCount: 0,
        snapshotAt: new Date().toISOString(),
      })
      await deferred
    })
    expect(screen.queryByText(row(1).sourceId)).toBeNull()
    expect(client.getQueryData(taskCenterKeys.sidebar(actor))).toBeUndefined()
    expect(api.success).not.toHaveBeenCalled()
  })
  it('正在查看同一任务时直接更新，不弹完成通知', async () => {
    let task = row()
    api.request.mockImplementation(async () => ({
      items: [task],
      activeCount: task.state === 'processing' ? 1 : 0,
      unseenCount: 0,
      snapshotAt: new Date().toISOString(),
    }))
    mount()
    await waitFor(() => expect(screen.getByText(task.sourceId)).toBeTruthy())
    fireEvent.click(screen.getByText('打开'))
    task = row(1, 'succeeded')
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2))
    expect(api.success).not.toHaveBeenCalled()
  })
  it('工具正在查看的终态共用摘要缓存，迟到结果仍观察，离开后停止', async () => {
    let task = row(9, 'succeeded')
    function RoutedProbe() {
      const summary = useQuery<TaskCenterSummary>({ queryKey:taskCenterKeys.summary(actor,task.sourceKind,task.requestId),enabled:false })
      return <span>工具已完成 {summary.data?.completedCount ?? 0}</span>
    }
    api.request.mockImplementation(async (path: string) => path.includes('by-request') ? task : {
      items: [1, 2, 3, 4, 5].map((index) => row(index)), activeCount: 5, unseenCount: 0,
      snapshotAt: new Date().toISOString(),
    })
    mount(<RoutedProbe />)
    await waitFor(() => expect(api.request).toHaveBeenCalledOnce())
    const viewing = { type:'observed' as const, actor, sourceKind:task.sourceKind, sourceId:task.sourceId, requestId:task.requestId, active:false }
    act(() => emitTaskCenter({ ...viewing, viewing:true }))
    await waitFor(() => expect(client.getQueryData<TaskCenterSummary>(taskCenterKeys.summary(actor, task.sourceKind, task.requestId))?.completedCount).toBe(1))
    expect(api.success).not.toHaveBeenCalled()
    task = { ...task, completedCount:2, partial:false, outcomeVersion:'v1:' + 'b'.repeat(32) }
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(client.getQueryData<TaskCenterSummary>(taskCenterKeys.summary(actor, task.sourceKind, task.requestId))?.completedCount).toBe(2))
    expect(api.success).not.toHaveBeenCalled()
    act(() => emitTaskCenter({ ...viewing, viewing:false }))
    const reads = api.request.mock.calls.filter(call => call[0].includes('by-request')).length
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(api.request.mock.calls.filter(call => call[0].includes('sidebar'))).toHaveLength(4))
    expect(api.request.mock.calls.filter(call => call[0].includes('by-request'))).toHaveLength(reads)
  })
  it('拒绝其他环境的工具观察事件，不查询或混入当前缓存', async () => {
    api.request.mockResolvedValue({ items:[],activeCount:0,unseenCount:0,snapshotAt:new Date().toISOString() })
    mount()
    await waitFor(() => expect(api.request).toHaveBeenCalledOnce())
    act(() => emitTaskCenter({ type:'observed', actor:{ ...actor,scope:'production' }, sourceKind:'image_job',sourceId:row().sourceId,requestId:row().requestId,viewing:true }))
    fireEvent.click(screen.getByText('刷新'))
    await waitFor(() => expect(api.request).toHaveBeenCalledTimes(2))
    expect(api.request.mock.calls.every(call => !call[0].includes('by-request'))).toBe(true)
  })
  it('断网即时提示且保留可信快照，恢复网络后可继续查询', async () => {
    api.request.mockResolvedValue({
      items: [row()],
      activeCount: 1,
      unseenCount: 0,
      snapshotAt: new Date().toISOString(),
    })
    mount()
    await waitFor(() => expect(screen.getByText(row().sourceId)).toBeTruthy())
    act(() => onlineManager.setOnline(false))
    expect(screen.getByText('查询暂不可用')).toBeTruthy()
    expect(screen.getByText(row().sourceId)).toBeTruthy()
    act(() => onlineManager.setOnline(true))
    await waitFor(() => expect(screen.getByText('正常')).toBeTruthy())
  })

  it('服务端停用响应关闭功能并保留原工具通知的接管条件', async () => {
    api.request.mockRejectedValue(
      new CloudError(503, '停用', 'TASK_CENTER_DISABLED'),
    )
    mount()
    await waitFor(() =>
      expect(useUserStore.getState().account?.features?.taskCenter).toBe(false),
    )
    expect(api.request).toHaveBeenCalledTimes(1)
    act(() => emitTaskCenter({ type: 'refresh' }))
    expect(api.request).toHaveBeenCalledTimes(1)
  })
})
