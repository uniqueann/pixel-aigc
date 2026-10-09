// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Capability, type GenerationTask } from '@/types'
import { useUserStore } from '@/store/useUserStore'
import { useTaskStore } from '@/store/useTaskStore'
import EmailAssistant from './index'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), settings: vi.fn(), auth: true }))
vi.mock('@/cloud/client', () => ({ get authEnabled() { return mocks.auth } }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useOutletContext: () => ({ openModelSettings: mocks.settings }) }))
vi.mock('@/services/api/task', () => ({
  createTask: vi.fn(), findTaskByRequest: vi.fn(), getTaskByRequest: vi.fn(), getTask: mocks.get,
  saveTaskEdit: vi.fn(), listTasks: mocks.list, deleteTask: vi.fn(),
  refreshCredits: vi.fn(),
}))
vi.mock('@/features/model-settings/useModelSettings', () => ({
  useModelSettings: () => ({
    settingsQuery: { data: { defaultEmailModelId: 'deepseek:flash' }, error: null },
    profilesQuery: { data: { items: [{ id: 'deepseek:flash', label: 'DeepSeek Flash', available: true, credits: 1, priceVersion: 'v1' }] }, error: null },
  }),
}))
vi.mock('@/services/api/billing', () => ({ openCreditRecharge: vi.fn(), refreshBillingBalance: vi.fn().mockResolvedValue(undefined) }))

const succeededTask = {
  id: 'S', capability: Capability.EmailAssist, status: 'succeeded',
  params: { sourceText: '客户邮件', operation: 'reply', language: 'zh' },
  resultText: '成功的回复内容', creditsCost: 3,
  createdAt: '2026-10-09T20:05:00.000Z', updatedAt: '2026-10-09T20:05:30.000Z',
} as GenerationTask<unknown>
const failedTask = {
  id: 'F', capability: Capability.EmailAssist, status: 'failed',
  params: { sourceText: '客户邮件', operation: 'reply', language: 'zh' },
  errorCode: 'PROVIDER_AUTH', errorMessage: 'DeepSeek 鉴权失败',
  createdAt: '2026-10-09T20:00:00.000Z', updatedAt: '2026-10-09T20:00:01.000Z',
} as GenerationTask<unknown>
const summary = (task: GenerationTask<unknown>) => ({ id: task.id, capability: 'email_assist', status: task.status,
  operation: 'reply', language: 'zh', preview: '客户邮件', createdAt: task.createdAt, updatedAt: task.updatedAt })

/** 刷新后恢复最新任务：横幅状态必须与当前展示的任务一致，不能残留旧任务的失败横幅。 */
describe('邮件助手刷新恢复', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    useUserStore.setState({ userId: 'u1', account: null })
    useTaskStore.setState({ tasks: {} })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = ({ children }) => <StrictMode><MemoryRouter initialEntries={['/email']}><QueryClientProvider client={client}><App>{children}</App></QueryClientProvider></MemoryRouter></StrictMode>
  })
  afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); useUserStore.setState({ userId: null }) })

  it('失败后成功再刷新：显示成功横幅，不残留失败横幅和重试按钮', async () => {
    mocks.list.mockResolvedValue({ items: [summary(succeededTask), summary(failedTask)], total: 2 })
    mocks.get.mockResolvedValue(succeededTask)
    render(<EmailAssistant />, { wrapper })
    await waitFor(() => expect(screen.getByDisplayValue('成功的回复内容')).toBeTruthy())
    expect(screen.getByText('生成完成')).toBeTruthy()
    expect(screen.queryByText('按原参数重试')).toBeNull()
    expect(screen.queryByText('生成失败')).toBeNull()
  })

  it('最新任务确实失败时：显示失败横幅和重试按钮，结果区为空', async () => {
    mocks.list.mockResolvedValue({ items: [summary(failedTask), summary(succeededTask)], total: 2 })
    mocks.get.mockResolvedValue(failedTask)
    render(<EmailAssistant />, { wrapper })
    await waitFor(() => expect(screen.getByText('生成失败')).toBeTruthy())
    expect(screen.getByText('按原参数重试')).toBeTruthy()
    expect(screen.getByPlaceholderText('生成结果将在这里显示')).toBeTruthy()
  })
})
