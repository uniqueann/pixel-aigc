// @vitest-environment jsdom

import { StrictMode, type ReactNode } from 'react'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { EMAIL_LANGUAGES, EMAIL_LANGUAGE_OPTIONS, emailModelVendor } from '@shared/email-models'
import { useUserStore } from '@/store/useUserStore'
import { useTaskStore } from '@/store/useTaskStore'
import EmailAssistant from './index'
import { MemoryRouter } from 'react-router-dom'

const mocks = vi.hoisted(() => ({ get: vi.fn(), list: vi.fn(), settings: vi.fn(), auth: false }))
vi.mock('@/cloud/client', () => ({ get authEnabled() { return mocks.auth } }))
vi.mock('react-router-dom', async importOriginal => ({ ...await importOriginal<typeof import('react-router-dom')>(), useOutletContext: () => ({ openModelSettings: mocks.settings }) }))
vi.mock('@/services/api/task', () => ({
  createTask: vi.fn(), findTaskByRequest: vi.fn(), getTaskByRequest: vi.fn(), getTask: mocks.get,
  saveTaskEdit: vi.fn(), listTasks: mocks.list, deleteTask: vi.fn(),
  refreshCredits: vi.fn(),
}))
vi.mock('@/features/model-settings/useModelSettings', () => ({
  useModelSettings: () => ({
    settingsQuery: { data: { defaultEmailModelId: 'deepseek:deepseek-flash' }, error: null },
    profilesQuery: { data: { items: [
      { id: 'deepseek:deepseek-flash', label: 'DeepSeek Flash', available: true, credits: 1, priceVersion: 'v1' },
      { id: 'deepseek:deepseek-v4-pro', label: 'DeepSeek V4 Pro', available: true, credits: 3, priceVersion: 'v1' },
      { id: 'ai-gateway:gemini-3.8-flash', label: 'Gemini 3.8 Flash', available: true, credits: 3, priceVersion: 'v1' },
    ] }, error: null },
  }),
}))

describe('邮件助手细节打磨', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode
  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} })
    mocks.list.mockResolvedValue({ items: [], total: 0 })
    useUserStore.setState({ userId: 'u1', account: null })
    useTaskStore.setState({ tasks: {} })
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = ({ children }) => <StrictMode><MemoryRouter initialEntries={['/email']}><QueryClientProvider client={client}><App>{children}</App></QueryClientProvider></MemoryRouter></StrictMode>
  })
  afterEach(() => { cleanup(); client?.clear(); vi.unstubAllGlobals(); useUserStore.setState({ userId: null }) })

  it('单模式模型旁没有多余的设置按钮', () => {
    render(<EmailAssistant />, { wrapper })
    expect(screen.queryByRole('button', { name: '设置' })).toBeNull()
  })

  it('语言下拉只有 8 个选项，没有美式/英式英语（完整列表仍兼容历史值）', () => {
    const values = EMAIL_LANGUAGE_OPTIONS.map(item => item.value)
    expect(values).not.toContain('en-US')
    expect(values).not.toContain('en-GB')
    expect(values).toContain('en')
    expect(EMAIL_LANGUAGE_OPTIONS).toHaveLength(8)
    expect(EMAIL_LANGUAGES.map(item => item.value)).toContain('en-GB')
  })

  it('邮件模型能识别出厂商图标', () => {
    expect(emailModelVendor('deepseek:deepseek-flash')).toBe('deepseek')
    expect(emailModelVendor('deepseek:deepseek-v4-pro')).toBe('deepseek')
    expect(emailModelVendor('ai-gateway:gemini-3.8-flash')).toBe('google')
    expect(emailModelVendor('unknown:model')).toBeUndefined()
    expect(emailModelVendor(undefined)).toBeUndefined()
  })
})
