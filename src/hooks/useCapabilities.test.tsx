// @vitest-environment jsdom

import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityFlags } from '@/services/api/capabilities'
import { useCapabilities } from './useCapabilities'

const mocks = vi.hoisted(() => ({ loadFlags: vi.fn() }))
vi.mock('@/services/api/capabilities', () => ({ loadCapabilityFlags: mocks.loadFlags }))
vi.mock('@/services/api/task', () => ({ liveCapabilityReady: () => false }))
vi.mock('@/cloud/client', () => ({ cloudEnabled: true }))

const configuredFlags: CapabilityFlags = {
  bgRemove: true, outpaint: true, erase: true, repaint: true,
  imageEdit: true, variation: true, smartSelect: true, textToImage: true, textToVideo: true, imageToVideo: true,
}

describe('共享功能配置', () => {
  let client: QueryClient
  let wrapper: ({ children }: { children: ReactNode }) => ReactNode

  beforeEach(() => {
    mocks.loadFlags.mockReset()
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    wrapper = ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>
  })

  afterEach(() => { cleanup(); client.clear() })

  it('加载期间保留未知状态，多个组件只发起一次查询', async () => {
    let resolve!: (flags: CapabilityFlags) => void
    mocks.loadFlags.mockReturnValue(new Promise<CapabilityFlags>(done => { resolve = done }))
    const first = renderHook(() => useCapabilities(), { wrapper })
    const second = renderHook(() => useCapabilities(), { wrapper })
    expect(Object.values(first.result.current.capabilities).every(value => value === undefined)).toBe(true)
    expect(second.result.current.capabilities.variation).toBeUndefined()
    expect(mocks.loadFlags).toHaveBeenCalledTimes(1)

    await act(async () => resolve(configuredFlags))
    await waitFor(() => expect(first.result.current.capabilities).toEqual(configuredFlags))
    expect(second.result.current.capabilities).toEqual(configuredFlags)
  })

  it('切换页面重新挂载时直接读取已确认的配置', async () => {
    mocks.loadFlags.mockResolvedValue(configuredFlags)
    const first = renderHook(() => useCapabilities(), { wrapper })
    await waitFor(() => expect(first.result.current.capabilities.variation).toBe(true))
    first.unmount()
    const second = renderHook(() => useCapabilities(), { wrapper })
    expect(second.result.current.capabilities).toEqual(configuredFlags)
    expect(mocks.loadFlags).toHaveBeenCalledTimes(1)
  })

  it('只有成功读取到关闭的配置才判定功能不可用', async () => {
    mocks.loadFlags.mockResolvedValue({ variation: false, repaint: false })
    const { result } = renderHook(() => useCapabilities(), { wrapper })
    expect(result.current.capabilities.variation).toBeUndefined()
    await waitFor(() => expect(result.current.capabilities.variation).toBe(false))
    expect(result.current.capabilities.repaint).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('首次加载失败仍保持未知状态，并能重试恢复', async () => {
    mocks.loadFlags.mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValue(configuredFlags)
    const { result } = renderHook(() => useCapabilities(), { wrapper })
    await waitFor(() => expect(result.current.error?.message).toBe('网络暂时不可用'))
    expect(Object.values(result.current.capabilities).every(value => value === undefined)).toBe(true)
    await act(async () => { await result.current.refetch() })
    await waitFor(() => expect(result.current.capabilities).toEqual(configuredFlags))
    expect(result.current.error).toBeNull()
  })

  it('后台刷新失败时继续保留上次确认的配置', async () => {
    mocks.loadFlags.mockResolvedValueOnce(configuredFlags).mockRejectedValue(new Error('刷新失败'))
    const { result } = renderHook(() => useCapabilities(), { wrapper })
    await waitFor(() => expect(result.current.capabilities.repaint).toBe(true))
    await act(async () => { await result.current.refetch() })
    expect(result.current.capabilities).toEqual(configuredFlags)
    expect(result.current.error).toBeNull()
  })
})
