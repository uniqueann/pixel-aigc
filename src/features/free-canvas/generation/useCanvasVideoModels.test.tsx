// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEEDANCE_VIDEO_MODEL } from '@shared/video-models'
import { useUserStore } from '@/store/useUserStore'
import { listVideoModels } from '@/services/api/videoModels'
import { canSubmitFreeCanvasVideo } from './availability'
import { useCanvasVideoModels } from './useCanvasVideoModels'

const flags = vi.hoisted(() => ({ textToVideo: false as boolean | undefined, imageToVideo: false as boolean | undefined, error: null as Error | null, refetch: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: true, cloudEnabled: true }))
vi.mock('@/hooks/useCapabilities', () => ({ useCapabilities: () => ({ capabilities: flags, error: flags.error, refetch: flags.refetch }) }))
vi.mock('@/services/api/videoModels', () => ({ listVideoModels: vi.fn() }))

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> }
}

describe('视频入口能力四态', () => {
  beforeEach(() => {
    flags.textToVideo = false; flags.imageToVideo = false; flags.error = null
    vi.mocked(listVideoModels).mockReset().mockResolvedValue([SEEDANCE_VIDEO_MODEL])
    useUserStore.setState({ userId: 'account-a' })
  })
  afterEach(() => { cleanup(); useUserStore.setState({ userId: null }) })

  it('关闭的视频不请求模型报价，也不因模型列表非空而开放', () => {
    const { result } = renderHook(() => useCanvasVideoModels(), setup())
    expect(result.current.textState).toBe('soon')
    expect(result.current.imageState).toBe('soon')
    expect(listVideoModels).not.toHaveBeenCalled()
    expect(canSubmitFreeCanvasVideo()).toBe(false)
  })

  it('未知和加载失败都不显示即将上线，重试成功后才开放', async () => {
    flags.textToVideo = undefined; flags.imageToVideo = undefined
    const { result, rerender } = renderHook(() => useCanvasVideoModels(), setup())
    expect(result.current.textState).toBe('loading')
    flags.error = new Error('网络错误'); rerender()
    expect(result.current.textState).toBe('error')
    flags.error = null; flags.textToVideo = true; rerender()
    expect(result.current.textState).toBe('loading')
    await waitFor(() => expect(result.current.textState).toBe('ready'))
    expect(canSubmitFreeCanvasVideo()).toBe(true)
  })

  it('文生视频和图生视频开关独立', async () => {
    flags.imageToVideo = true
    const { result } = renderHook(() => useCanvasVideoModels(), setup())
    await waitFor(() => expect(result.current.imageState).toBe('ready'))
    expect(result.current.textState).toBe('soon')
    expect(canSubmitFreeCanvasVideo()).toBe(false)
    expect(canSubmitFreeCanvasVideo('image_to_video')).toBe(true)
  })

  it('模型请求失败有重试状态，关闭能力后恢复即将上线提示', async () => {
    flags.textToVideo = true
    vi.mocked(listVideoModels).mockRejectedValueOnce(new Error('模型请求失败'))
    const { result, rerender } = renderHook(() => useCanvasVideoModels(), setup())
    await waitFor(() => expect(result.current.textState).toBe('error'))
    flags.textToVideo = false; rerender()
    expect(result.current.textState).toBe('soon')
    expect(result.current.error).toBeNull()
  })

  it('切换账号后不能使用旧账号已经就绪的视频配置', async () => {
    flags.textToVideo = true
    const { result } = renderHook(() => useCanvasVideoModels(), setup())
    await waitFor(() => expect(result.current.ready).toBe(true))
    vi.mocked(listVideoModels).mockImplementation(() => new Promise(() => undefined))
    act(() => useUserStore.setState({ userId: 'account-b' }))
    expect(result.current.ready).toBe(false)
    expect(result.current.models).toEqual([])
    expect(canSubmitFreeCanvasVideo()).toBe(false)
  })
})
