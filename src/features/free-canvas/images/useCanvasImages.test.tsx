// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { createImageAsset } from '@/editor/services/assetService'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import type { Asset, ImageNode } from '@/editor/types'
import { useCanvasImages } from './useCanvasImages'

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
const mocks = vi.hoisted(() => ({ read: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: false, cloudEnabled: false }))
vi.mock('@/services/api/ownedImages', () => ({ readOwnedImage: mocks.read, invalidateOwnedImage: mocks.invalidate }))
vi.mock('@/features/image-workstation/imageMetadata', () => ({ readResultImage: async (blob: Blob) => ({ blob, width: 100, height: 100, mimeType: 'image/png' }) }))
let rendered: ReturnType<typeof useCanvasImages>
const EMPTY: Record<string, Asset> = {}
function Harness() {
  const project = useEditorStore(state => state.project)
  const images = useCanvasImages(project?.assets ?? EMPTY, project?.document.scenes[0])
  useEffect(() => { rendered = images }, [images])
  return null
}
describe('私有画布图片的运行时恢复', () => {
  let root: Root
  let container: HTMLDivElement
  beforeEach(() => {
    vi.resetAllMocks()
    let serial = 0
    URL.createObjectURL = vi.fn(() => `blob:canvas-${serial++}`)
    URL.revokeObjectURL = vi.fn()
    mocks.read.mockResolvedValue(new Blob(['图片'], { type: 'image/png' }))
    const project = useEditorStore.getState().createProject('私有图片测试')
    usePersistenceStore.setState({ epoch: 0 })
    const asset = createImageAsset({ id: 'owned', name: '私有图片', url: '/__aigc_asset__/owned', objectKey: 'owned-object', width: 100, height: 100 })
    const node: ImageNode = { id: 'node', type: 'image', assetId: asset.id, name: asset.name, x: 0, y: 0, width: 100, height: 100, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0 }
    useEditorStore.getState().registerAsset(asset)
    useEditorStore.getState().addNode(project.document.activeSceneId, node)
    container = document.createElement('div')
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    useEditorStore.getState().createProject('释放资源')
  })

  it('对象占位地址按所属账号读取，Blob 只进入视图，项目数据保留对象键', async () => {
    await act(async () => root.render(<Harness />))
    expect(mocks.read).toHaveBeenCalledWith({ objectKey: 'owned-object', url: undefined, expiresAt: undefined }, { ownerId: 'anonymous', signal: expect.any(AbortSignal) })
    expect(rendered.assets.owned).toMatchObject({ url: 'blob:canvas-0', missing: false })
    expect(useEditorStore.getState().project?.assets.owned.url).toBe('/__aigc_asset__/owned')
    await act(async () => useEditorStore.getState().removeNode(useEditorStore.getState().activeSceneId!, 'node'))
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:canvas-0')
  })

  it('读取失败保留领域节点，重试读取不会重新生成', async () => {
    mocks.read.mockRejectedValueOnce(new Error('签名读取失败'))
    await act(async () => root.render(<Harness />))
    expect(rendered.error).toContain('签名读取失败')
    expect(rendered.assets.owned.missing).toBe(true)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toHaveLength(1)
    await act(async () => rendered.reload())
    expect(mocks.read).toHaveBeenCalledTimes(2)
    expect(mocks.invalidate).toHaveBeenCalledWith('anonymous', 'owned-object')
    expect(rendered.error).toBeUndefined()
    expect(rendered.assets.owned.url).toBe('blob:canvas-0')
  })

  it('切换项目后丢弃旧读取结果并取消原消费方', async () => {
    let resolve!: (blob: Blob) => void
    mocks.read.mockImplementationOnce(() => new Promise<Blob>(done => { resolve = done }))
    await act(async () => root.render(<Harness />))
    const signal = mocks.read.mock.calls[0][1].signal as AbortSignal
    await act(async () => { useEditorStore.getState().createProject('新的画布') })
    expect(signal.aborted).toBe(true)
    await act(async () => resolve(new Blob(['旧图片'])))
    expect(URL.createObjectURL).not.toHaveBeenCalled()
    expect(rendered.assets).toEqual({})
  })
})
