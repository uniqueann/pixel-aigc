// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { App } from 'antd'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore, type AccountContext } from '@/store/useUserStore'
import type { TaskCenterSummary } from '@shared/task-center'
import { TaskCenterContext, type TaskCenterContextValue } from './context'
import { TaskCenterDrawer } from './TaskCenterDrawer'
const mocks = vi.hoisted(() => ({ request: vi.fn(), copy: vi.fn() }))
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
  authEnabled: true,
  cloudEnabled: false,
  supabase: null,
  cloudRequest: mocks.request,
}))
const actor = {
  owner: '00000000-0000-4000-8000-000000000081',
  scope: 'preview' as const,
}
const task: TaskCenterSummary = {
  sourceKind: 'email_task',
  sourceId: actor.owner,
  taskKey: `email_task:${actor.owner}`,
  requestId: actor.owner,
  tool: 'email-assist',
  capability: 'email_assist',
  modelProfileId: 'fixture',
  state: 'succeeded',
  requestedCount: 1,
  completedCount: 1,
  partial: false,
  errorCode: null,
  warnings: [],
  origin: null,
  billingState: 'settled',
  creditsReserved: 1,
  creditsCharged: 1,
  creditsReturned: 0,
  resultAvailability: 'available',
  resultExpiresAt: null,
  taskExpiresAt: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  completedAt: null,
  outcomeVersion: 'v1:' + 'a'.repeat(32),
  seen: false,
  dismissed: false,
}
let client: QueryClient
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  useUserStore.getState().setAccount({
    userId: actor.owner,
    runtimeScope: 'preview',
    features: { taskCenter: true },
  } as AccountContext)
  vi.stubGlobal('matchMedia', () => ({
    matches: false,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }))
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: mocks.copy },
    configurable: true,
  })
  mocks.copy.mockResolvedValue(undefined)
  mocks.request.mockImplementation(async (_path: string, method: string) =>
    method === 'PATCH'
      ? task
      : {
          task,
          params: { sourceText: '私有输入' },
          errorMessage: null,
          results: [
            {
              kind: 'text',
              text: '原生成结果正文',
              editedText: '已有修改稿正文',
            },
          ],
        },
  )
})
afterEach(() => {
  cleanup()
  client.clear()
  useUserStore.getState().setAccount(null)
  vi.unstubAllGlobals()
})
function mount(overrides: Partial<TaskCenterContextValue> = {}) {
  const context: TaskCenterContextValue = {
    actor,
    selected: task,
    open: true,
    loading: false,
    error: null,
    receipts: [],
    tool: undefined,
    state: 'all',
    show: vi.fn(),
    close: vi.fn(),
    filter: vi.fn(),
    refresh: vi.fn(),
    forget: vi.fn(),
    credits: vi.fn(),
    ...overrides,
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter><App>
        <TaskCenterContext.Provider value={context}>
          <textarea aria-label="工具草稿" defaultValue="保持草稿" />
          <TaskCenterDrawer />
        </TaskCenterContext.Provider>
      </App></MemoryRouter>
    </QueryClientProvider>,
  )
  return context
}
describe('共用只读任务抽屉', () => {
  it('模型只显示目录名称，不显示原始 id 或渠道', async () => {
    mocks.request.mockImplementation(async (_path: string, method: string) => {
      const named = { ...task, modelProfileId: 'openrouter:gemini-nano-banana-2.1' }
      return method === 'PATCH' ? named : {
        task: named,
        params: { sourceText: '私有输入' },
        errorMessage: null,
        results: [{ kind: 'text', text: '原生成结果正文', editedText: null }],
      }
    })
    mount({ selected: { ...task, modelProfileId: 'openrouter:gemini-nano-banana-2.1' } })
    expect(await screen.findByText('Nano Banana 2.1')).toBeTruthy()
    expect(screen.queryByText('openrouter:gemini-nano-banana-2.1')).toBeNull()
    expect(screen.queryByText('gemini-nano-banana-2.1')).toBeNull()
    expect(screen.queryByText(/OpenRouter|Google/)).toBeNull()
  })

  it('原结果和修改稿可复制；草稿不被覆盖，仅发送 GET 和展示 PATCH', async () => {
    mount()
    expect(await screen.findByText('原生成结果正文')).toBeTruthy()
    expect(screen.getByText('历史模型')).toBeTruthy()
    expect(screen.queryByText('fixture')).toBeNull()
    expect(screen.getByText('历史模型')).toBeTruthy()
    expect(screen.queryByText('fixture')).toBeNull()
    expect(screen.getByText('已有修改稿正文')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '复制结果' }))
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith('原生成结果正文'),
    )
    fireEvent.click(screen.getByRole('button', { name: '复制修改稿' }))
    await waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith('已有修改稿正文'),
    )
    expect(
      (screen.getByLabelText('工具草稿') as HTMLTextAreaElement).value,
    ).toBe('保持草稿')
    expect(
      mocks.request.mock.calls.every((call) =>
        ['GET', 'PATCH'].includes(call[1]),
      ),
    ).toBe(true)
    expect(
      mocks.request.mock.calls.some(
        (call) => call[1] === 'PATCH' && call[2].action === 'seen',
      ),
    ).toBe(true)
  })
  it('移除只修改展示版本，不删除任务、退款或重新生成', async () => {
    const context = mount()
    await screen.findByText('原生成结果正文')
    fireEvent.click(screen.getByRole('button', { name: '移出列表' }))
    await waitFor(() =>
      expect(
        mocks.request.mock.calls.some(
          (call) =>
            call[1] === 'PATCH' &&
            call[2].action === 'dismiss' &&
            call[2].outcomeVersion === task.outcomeVersion,
        ),
      ).toBe(true),
    )
    expect(
      mocks.request.mock.calls.every((call) =>
        ['GET', 'PATCH'].includes(call[1]),
      ),
    ).toBe(true)
    await waitFor(() => expect(context.show).toHaveBeenCalled())
  })

  it('任务详情底部吸底工具条正常渲染并采用主题设计变量', async () => {
    mount()
    await screen.findByText('原生成结果正文')
    const footer = document.querySelector('.ant-drawer-footer .task-drawer-footer')
    expect(footer).toBeTruthy()
    expect(screen.getByRole('button', { name: '查看积分明细' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '移出列表' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '在工具中查看' })).toBeTruthy()

    const css = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')
    expect(css).toContain('.task-center-drawer .ant-drawer-footer')
    expect(css).toMatch(/\.task-center-drawer \.ant-drawer-footer\s*\{[^}]*background:\s*var\(--color-surface\)/)
    expect(css).toMatch(/\.task-drawer-footer \.ant-btn-primary\s*\{[^}]*background:\s*var\(--color-accent\)/)
  })
})
