// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { App } from 'antd'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelSettings } from '@/services/api/modelSettings'
import { useUserStore } from '@/store/useUserStore'
import EmailAssistant from '@/pages/EmailAssistant'
import ModelSettingsPanel from './ModelSettingsPanel'
import { useModelSettings } from './useModelSettings'

const mocks = vi.hoisted(() => ({ getSettings: vi.fn(), getProfiles: vi.fn(), saveKey: vi.fn(), generate: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true }))
vi.mock('@/services/api/modelSettings', () => ({
  getModelSettings: mocks.getSettings, getModelProfiles: mocks.getProfiles,
  saveDeepSeekKey: mocks.saveKey, deleteDeepSeekKey: vi.fn(), saveDefaultEmailModel: vi.fn(), testDeepSeekKey: vi.fn(),
}))
vi.mock('react-router-dom', () => ({ useOutletContext: () => ({ openModelSettings: vi.fn() }) }))
vi.mock('@/features/email-assistant/useEmailAssistantController', () => ({
  useEmailAssistantController: () => ({
    generate: mocks.generate, formLocked: false, submitting: false, resultText: '', history: [],
    active: false, polling: false,
  }),
}))
vi.mock('@/components/GenerationTaskStatus', () => ({ default: () => null }))

const configured: ModelSettings = {
  deepseek: { configured: true, keyTail: '1234', verificationStatus: 'valid', verifiedAt: null },
  defaultEmailModelId: 'deepseek:deepseek-flash',
}
const unconfigured: ModelSettings = {
  ...configured, deepseek: { configured: false, keyTail: null, verificationStatus: null, verifiedAt: null },
}
const missingKeyMessage = '配置自己的 DeepSeek API Key 后即可生成'

/** 按按钮文字定位，避免 jsdom 为可访问名称计算整页样式。 */
function buttonByText(name: RegExp) {
  const button = screen.getByText(name).closest('button')
  if (!button) throw new Error('未找到对应按钮')
  return button
}

describe('邮件模型配置状态', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addListener: vi.fn(), removeListener: vi.fn() })))
    mocks.getSettings.mockReset()
    mocks.getProfiles.mockReset().mockResolvedValue({
      items: [{ id: configured.defaultEmailModelId, provider: 'deepseek', label: 'DeepSeek Flash', capability: 'email_assist' }],
    })
    mocks.saveKey.mockReset()
    mocks.generate.mockReset().mockResolvedValue({ status: 'succeeded' })
    useUserStore.getState().setUser('测试用户一', 'free')
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = ({ children }) => <QueryClientProvider client={client}><App>{children}</App></QueryClientProvider>
  })

  afterEach(() => { cleanup(); client.clear(); useUserStore.getState().setAccount(null); vi.unstubAllGlobals() })

  it('首次打开时等待已配置的密钥，不闪现配置提示，并在加载完成后允许生成', async () => {
    let resolve!: (settings: ModelSettings) => void
    mocks.getSettings.mockReturnValue(new Promise<ModelSettings>(done => { resolve = done }))
    render(<EmailAssistant />, { wrapper })
    fireEvent.change(screen.getByPlaceholderText('粘贴需要处理的邮件内容'), { target: { value: '请确认商品的发货时间。' } })
    expect(screen.queryByText(missingKeyMessage)).toBeNull()
    expect(buttonByText(/^生\s*成$/).disabled).toBe(true)

    await act(async () => resolve(configured))
    await waitFor(() => expect(buttonByText(/^生\s*成$/).disabled).toBe(false))
    expect(screen.queryByText(missingKeyMessage)).toBeNull()
    fireEvent.click(buttonByText(/^生\s*成$/))
    await waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(expect.objectContaining({ sourceText: '请确认商品的发货时间。' }), configured.defaultEmailModelId))
  })

  it('确实未配置时只在配置返回后显示提示', async () => {
    let resolve!: (settings: ModelSettings) => void
    mocks.getSettings.mockReturnValue(new Promise<ModelSettings>(done => { resolve = done }))
    render(<EmailAssistant />, { wrapper })
    expect(screen.queryByText(missingKeyMessage)).toBeNull()
    await act(async () => resolve(unconfigured))
    await waitFor(() => expect(screen.getByText(missingKeyMessage)).toBeTruthy())
  })

  it('邮件配置加载失败显示重试入口，不误报缺少密钥', async () => {
    mocks.getSettings.mockRejectedValueOnce(new Error('网络错误')).mockResolvedValue(configured)
    render(<EmailAssistant />, { wrapper })
    await waitFor(() => expect(screen.getByText('模型设置加载失败，请重试')).toBeTruthy())
    expect(screen.queryByText(missingKeyMessage)).toBeNull()
    fireEvent.click(buttonByText(/^重\s*试$/))
    await waitFor(() => expect(screen.queryByText('模型设置加载失败，请重试')).toBeNull())
    expect(screen.getByText('DeepSeek Flash')).toBeTruthy()
  })

  it('模型设置面板加载失败时不显示尚未配置或未配置', async () => {
    mocks.getSettings.mockRejectedValue(new Error('网络错误'))
    render(<ModelSettingsPanel />, { wrapper })
    await waitFor(() => expect(screen.getByText('模型设置加载失败，请重试')).toBeTruthy())
    expect(screen.queryByText('尚未配置')).toBeNull()
    expect(screen.queryByText('未配置')).toBeNull()
  })

  it('邮件页面和设置面板复用配置，重新进入页面时没有未配置的中间状态', async () => {
    mocks.getSettings.mockResolvedValue(configured)
    const first = render(<EmailAssistant />, { wrapper })
    await waitFor(() => expect(screen.getByText('DeepSeek Flash')).toBeTruthy())
    first.unmount()
    render(<><EmailAssistant /><ModelSettingsPanel /></>, { wrapper })
    expect(screen.queryByText(missingKeyMessage)).toBeNull()
    expect(screen.getByText('已验证')).toBeTruthy()
    expect(mocks.getSettings).toHaveBeenCalledTimes(1)
    expect(mocks.getProfiles).toHaveBeenCalledTimes(1)
  })

  it('保存密钥后立即同步邮件页面，后台刷新期间保持已配置状态', async () => {
    mocks.getSettings.mockResolvedValueOnce(unconfigured).mockReturnValue(new Promise<ModelSettings>(() => undefined))
    mocks.saveKey.mockResolvedValue(configured)
    render(<><EmailAssistant /><ModelSettingsPanel /></>, { wrapper })
    await waitFor(() => expect(screen.getByText('尚未配置')).toBeTruthy())
    expect(screen.getByText(missingKeyMessage)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('DeepSeek API Key'), { target: { value: '测试密钥' } })
    fireEvent.click(buttonByText(/^保\s*存$/))
    await waitFor(() => expect(screen.getByText('已验证')).toBeTruthy())
    expect(screen.queryByText(missingKeyMessage)).toBeNull()
    await waitFor(() => expect(mocks.getSettings).toHaveBeenCalledTimes(2))
  })

  it('保存前发起的旧查询即使迟到，也不能覆盖新配置', async () => {
    let resolve!: (settings: ModelSettings) => void
    mocks.getSettings.mockReturnValue(new Promise<ModelSettings>(done => { resolve = done }))
    const { result } = renderHook(() => useModelSettings(), { wrapper })
    await act(async () => { await result.current.updateSettings(configured) })
    await waitFor(() => expect(result.current.settingsQuery.data).toEqual(configured))
    await act(async () => resolve(unconfigured))
    expect(result.current.settingsQuery.data).toEqual(configured)
  })

  it('切换账号后不会沿用上一账号的密钥状态', async () => {
    let resolve!: (settings: ModelSettings) => void
    mocks.getSettings.mockResolvedValueOnce(configured)
      .mockReturnValue(new Promise<ModelSettings>(done => { resolve = done }))
    const { result } = renderHook(() => useModelSettings(), { wrapper })
    await waitFor(() => expect(result.current.settingsQuery.data).toEqual(configured))
    act(() => useUserStore.getState().setUser('测试用户二', 'free'))
    expect(result.current.settingsQuery.data).toBeUndefined()
    await act(async () => resolve(unconfigured))
    await waitFor(() => expect(result.current.settingsQuery.data).toEqual(unconfigured))
  })
})
