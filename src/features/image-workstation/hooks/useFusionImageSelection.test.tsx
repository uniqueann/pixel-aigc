// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
import { useFusionImageSelection } from './useFusionImageSelection'

const mocks = vi.hoisted(() => ({ load: vi.fn() }))
vi.mock('@/services/api/upload', () => ({ uploadImage: mocks.load, uploadTaskInput: vi.fn() }))
vi.mock('@/features/assets/historyOwner', async () => {
  const { useUserStore: store } = await import('@/store/useUserStore')
  return { currentWorkstationHistoryOwner: () => store.getState().userId!, isCurrentWorkstationHistoryOwner: (owner: string) => owner === store.getState().userId }
})
const uploaded = (name: string) => ({ name, url: `data:image/png;base64,${name}`, width: 100, height: 200, mimeType: 'image/png' })
beforeEach(() => { useUserStore.getState().setUser('owner', 'free'); mocks.load.mockReset() })
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('融合选图生命周期', () => {
  it('同槽位旧文件晚到不会覆盖新文件，两个槽位分别显示忙碌状态', async () => {
    let finish!: (image: ReturnType<typeof uploaded>) => void
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValueOnce(uploaded('新商品'))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => {})
    let old!: Promise<unknown>
    await act(async () => { old = result.current.load('product', new File(['old'], 'old.png')).catch(error => error) })
    expect(result.current.loading).toEqual({ product: true, reference: false })
    await act(async () => { await result.current.load('product', new File(['new'], 'new.png')) })
    await act(async () => { finish(uploaded('旧商品')); await old })
    expect(result.current.product?.name).toBe('新商品')
    expect(result.current.loading.product).toBe(false)
  })
  it('换账号隐藏旧图片，并拒绝旧账号的迟到读取', async () => {
    mocks.load.mockResolvedValueOnce(uploaded('商品'))
    let finish!: (image: ReturnType<typeof uploaded>) => void
    mocks.load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => { await result.current.load('product', new File(['p'], 'p.png')) })
    let pending!: Promise<unknown>
    await act(async () => { pending = result.current.load('reference', new File(['s'], 's.png')).catch(error => error) })
    await act(async () => { useUserStore.getState().setUser('new-owner', 'free'); finish(uploaded('旧场景')); await pending })
    expect(result.current.product).toBeUndefined()
    expect(result.current.reference).toBeUndefined()
    expect((await pending as Error).name).toBe('AbortError')
  })
  it('切换工具后迟到文件不更新输入', async () => {
    let finish!: (image: ReturnType<typeof uploaded>) => void
    mocks.load.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const { result, rerender } = renderHook(({ tool }) => useFusionImageSelection(tool), { initialProps: { tool: 'fusion' } })
    let pending!: Promise<unknown>
    await act(async () => { pending = result.current.load('reference', new File(['s'], 's.png')).catch(error => error) })
    rerender({ tool: 'smart-edit' })
    await act(async () => { finish(uploaded('场景')); await pending })
    expect(result.current.reference).toBeUndefined()
    expect(result.current.loading.reference).toBe(false)
  })
})
