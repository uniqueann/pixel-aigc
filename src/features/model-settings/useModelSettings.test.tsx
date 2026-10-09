// @vitest-environment jsdom
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
import { useModelSettings } from './useModelSettings'
import { useEmailModelConfiguration } from '../email-assistant/useEmailModelConfiguration'
import type { ModelSettings } from '@/services/api/modelSettings'

const mocks = vi.hoisted(() => ({ settings: vi.fn(), profiles: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true }))
vi.mock('@/services/api/modelSettings', () => ({ getModelSettings: mocks.settings, getModelProfiles: mocks.profiles }))
let client: QueryClient
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  useUserStore.getState().setUser('用户一', 'free')
  mocks.settings.mockReset().mockResolvedValue({ defaultEmailModelId: null })
  mocks.profiles.mockReset().mockResolvedValue({ items: [{ id: 'deepseek:deepseek-flash', available: true, credits: 1 }] })
})
afterEach(() => { cleanup(); client.clear(); useUserStore.getState().setAccount(null) })
describe('平台模型目录与账户偏好', () => {
  it('未保存默认模型也可使用平台服务，不依赖个人密钥', async () => {
    const { result } = renderHook(() => useEmailModelConfiguration(), { wrapper })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.defaultModelProfileId).toBeUndefined()
  })
  it('服务关闭和加载失败分别呈现，不误报个人密钥', async () => {
    mocks.profiles.mockResolvedValue({ items: [{ available: false }] })
    const { result } = renderHook(() => useEmailModelConfiguration(), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.ready).toBe(false)
    expect(result.current.error).toBeNull()
    mocks.profiles.mockRejectedValue(new Error('网络失败'))
    await act(async () => { client.removeQueries({ queryKey: ['model-profiles'] }); await result.current.profilesQuery.refetch() })
    await waitFor(() => expect(result.current.error).toBeTruthy())
  })
  it('保存前的迟到查询不能覆盖新偏好', async () => {
    let resolve!: (settings: ModelSettings) => void
    mocks.settings.mockReturnValue(new Promise(done => { resolve = done }))
    const { result } = renderHook(() => useModelSettings(), { wrapper })
    const updated: ModelSettings = { defaultEmailModelId: 'ai-gateway:gemini-3.8-flash' }
    await act(async () => { await result.current.updateSettings(updated) })
    await waitFor(() => expect(result.current.settingsQuery.data).toEqual(updated))
    await act(async () => resolve({ defaultEmailModelId: null }))
    expect(result.current.settingsQuery.data).toEqual(updated)
  })
  it('账号切换不会继承另一账号的默认型号和目录缓存', async () => {
    mocks.settings.mockResolvedValueOnce({ defaultEmailModelId: 'deepseek:deepseek-flash' })
    const { result } = renderHook(() => useModelSettings(), { wrapper })
    await waitFor(() => expect(result.current.settingsQuery.data?.defaultEmailModelId).toBe('deepseek:deepseek-flash'))
    act(() => useUserStore.getState().setUser('用户二', 'free'))
    expect(result.current.settingsQuery.data).toBeUndefined()
    await waitFor(() => expect(result.current.settingsQuery.data?.defaultEmailModelId).toBeNull())
    expect(mocks.profiles).toHaveBeenCalledTimes(2)
  })
})
