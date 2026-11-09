// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
import { useFusionImageSelection } from './useFusionImageSelection'

const mocks = vi.hoisted(() => ({ load: vi.fn(), sceneMeta: vi.fn(), sceneRead: vi.fn(), sceneRemember: vi.fn() }))
vi.mock('@/services/api/upload', () => ({ uploadImage: mocks.load, uploadTaskInput: vi.fn() }))
vi.mock('../fusionSceneMemory', async importOriginal => ({
  ...await importOriginal<typeof import('../fusionSceneMemory')>(),
  readFusionSceneMeta: mocks.sceneMeta,
  readFusionScene: mocks.sceneRead,
  rememberFusionScene: mocks.sceneRemember,
}))
vi.mock('@/features/assets/historyOwner', async () => {
  const { useUserStore: store } = await import('@/store/useUserStore')
  return { currentWorkstationHistoryOwner: () => store.getState().userId!, isCurrentWorkstationHistoryOwner: (owner: string) => owner === store.getState().userId }
})
const uploaded = (name: string) => ({ name, url: `data:image/png;base64,${name}`, width: 100, height: 200, mimeType: 'image/png' })
beforeEach(() => {
  useUserStore.getState().setUser('owner', 'free')
  mocks.load.mockReset()
  mocks.sceneMeta.mockReset().mockResolvedValue(undefined)
  mocks.sceneRead.mockReset().mockResolvedValue(undefined)
  mocks.sceneRemember.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => 'blob:last-scene') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: vi.fn() })
})
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
  it('单张载入失败只在对应槽位记录错误，重新载入成功后清除', async () => {
    mocks.load.mockRejectedValueOnce(new Error('仅支持 PNG、JPEG 和 WebP 图片')).mockResolvedValueOnce(uploaded('商品'))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => { await result.current.load('product', new File(['x'], 'x.txt')).catch(() => {}) })
    expect(result.current.errors.product).toBe('仅支持 PNG、JPEG 和 WebP 图片')
    expect(result.current.errors.reference).toBeUndefined()
    expect(result.current.loading.product).toBe(false)
    await act(async () => { await result.current.load('product', new File(['p'], 'p.png')) })
    expect(result.current.errors.product).toBeUndefined()
    expect(result.current.product?.name).toBe('商品')
  })
  it('移除槽位或切换账号后不残留载入错误', async () => {
    mocks.load.mockRejectedValueOnce(new Error('读取图片失败'))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => { await result.current.load('reference', new File(['s'], 's.png')).catch(() => {}) })
    expect(result.current.errors.reference).toBe('读取图片失败')
    await act(async () => { result.current.clear('reference') })
    expect(result.current.errors.reference).toBeUndefined()

    mocks.load.mockRejectedValueOnce(new Error('上传接口没有返回图片地址'))
    await act(async () => { await result.current.load('product', new File(['p'], 'p.png')).catch(() => {}) })
    expect(result.current.errors.product).toBe('上传接口没有返回图片地址')
    await act(async () => { useUserStore.getState().setUser('new-owner', 'free') })
    expect(result.current.errors.product).toBeUndefined()
  })
  it('交换商品与场景，移除单个槽位后保留另一张', async () => {
    mocks.load.mockResolvedValueOnce(uploaded('商品')).mockResolvedValueOnce(uploaded('场景'))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => { await result.current.load('product', new File(['p'], 'p.png')) })
    await act(async () => { await result.current.load('reference', new File(['s'], 's.png')) })
    await act(async () => { result.current.swap() })
    expect(result.current.product?.name).toBe('场景')
    expect(result.current.reference?.name).toBe('商品')
    await act(async () => { result.current.clear('product') })
    expect(result.current.product).toBeUndefined()
    expect(result.current.reference?.name).toBe('商品')
  })
  it('上传场景后记住最近场景，交换后改为新的场景图', async () => {
    mocks.load.mockResolvedValueOnce(uploaded('场景')).mockResolvedValueOnce(uploaded('商品'))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => { await result.current.load('reference', new File(['s'], '场景.png', { type: 'image/png' })) })
    expect(mocks.sceneRemember).toHaveBeenCalledWith('owner', expect.objectContaining({ name: '场景', width: 100, height: 200, mimeType: 'image/png' }))
    expect(result.current.lastScene).toMatchObject({ name: '场景', width: 100, height: 200 })
    await act(async () => { await result.current.load('product', new File(['p'], '商品.png', { type: 'image/png' })) })
    await act(async () => { result.current.swap() })
    expect(result.current.reference?.name).toBe('商品')
    expect(result.current.lastScene?.name).toBe('商品')
    expect(mocks.sceneRemember).toHaveBeenLastCalledWith('owner', expect.objectContaining({ name: '商品' }))
  })
  it('空场景槽位可复用上次场景', async () => {
    mocks.sceneRead.mockResolvedValueOnce({ blob: new Blob(['last'], { type: 'image/png' }), name: '客厅.png', width: 1200, height: 800, mimeType: 'image/png', savedAt: '2026-11-09T00:00:00.000Z' })
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    let asset: { name?: string; url?: string } | undefined
    await act(async () => { asset = await result.current.reuseLastScene() })
    expect(asset).toMatchObject({ name: '客厅.png', url: 'blob:last-scene' })
    expect(result.current.reference?.name).toBe('客厅.png')
    expect(result.current.loading.reference).toBe(false)
  })
  it('换账号后不采用旧账号的上次场景', async () => {
    let finish!: (scene: unknown) => void
    mocks.sceneRead.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    let pending!: Promise<unknown>
    await act(async () => { pending = result.current.reuseLastScene() })
    await act(async () => {
      useUserStore.getState().setUser('new-owner', 'free')
      finish({ blob: new Blob(['last'], { type: 'image/png' }), name: '客厅.png', width: 1200, height: 800, mimeType: 'image/png', savedAt: '2026-11-09T00:00:00.000Z' })
      await pending
    })
    expect(await pending).toBeUndefined()
    expect(result.current.reference).toBeUndefined()
  })
  it('只有一张图时交换不产生空槽位', async () => {
    mocks.load.mockResolvedValueOnce(uploaded('商品'))
    const { result } = renderHook(() => useFusionImageSelection('fusion'))
    await act(async () => { await result.current.load('product', new File(['p'], 'p.png')) })
    await act(async () => { result.current.swap() })
    expect(result.current.product?.name).toBe('商品')
    expect(result.current.reference).toBeUndefined()
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
