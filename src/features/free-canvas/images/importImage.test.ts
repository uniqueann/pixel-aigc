// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import type { WorkstationHistoryListItem } from '@/features/assets/workstationHistory'
import { importCanvasFile, importCanvasHistory, type CanvasImageImportContext } from './importImage'

const mocks = vi.hoisted(() => ({ upload: vi.fn(), read: vi.fn(), measure: vi.fn() }))
vi.mock('@/cloud/client', () => ({ authEnabled: false, cloudEnabled: false }))
vi.mock('@/services/api/upload', () => ({ uploadImage: mocks.upload }))
vi.mock('@/services/api/ownedImages', () => ({ readOwnedImage: mocks.read }))
vi.mock('@/features/image-workstation/imageMetadata', () => ({ readResultImage: mocks.measure }))

let context: CanvasImageImportContext
const blob = new Blob(['图片内容'], { type: 'image/png' })
const record: WorkstationHistoryListItem = { id: 'task:o3', taskId: 'task', ordinal: 3, toolSlug: 'variation', capability: 'variation' as WorkstationHistoryListItem['capability'], objectKey: 'owned-result', width: 100, height: 100, mimeType: 'image/png', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }
beforeEach(() => {
  vi.resetAllMocks()
  const project = useEditorStore.getState().createProject('图片导入测试')
  usePersistenceStore.setState({ writable: true, epoch: 0 })
  context = { ownerId: 'anonymous', projectId: project.id, sceneId: project.document.activeSceneId, epoch: 0, center: { x: 500, y: 300 }, signal: new AbortController().signal }
  mocks.upload.mockResolvedValue({ name: '图片.png', url: 'data:image/png;base64,aW1hZ2U=', width: 1600, height: 900, mimeType: 'image/png' })
  mocks.read.mockResolvedValue(blob)
  mocks.measure.mockResolvedValue({ blob, width: 1600, height: 900, mimeType: 'image/png' })
})
describe('单张图片入画布', () => {
  it('本地图片在当前视口中心加入一条命令，撤销与重做恢复一致', async () => {
    const file = new File([blob], '图片.png', { type: 'image/png' })
    const { node } = await importCanvasFile(file, context)
    expect(mocks.upload).toHaveBeenCalledWith(file, { local: true })
    expect(node.x + node.width / 2).toBe(context.center.x)
    expect(node.y + node.height / 2).toBe(context.center.y)
    const state = useEditorStore.getState()
    expect(state.undoStack).toHaveLength(1)
    expect(state.selectedNodeIds).toEqual([node.id])
    state.undo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
    state.redo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([node])
  })

  it('资产使用所属账号读取原图，采用真实尺寸，重复加入共享 Asset 而节点独立', async () => {
    const { node: first } = await importCanvasHistory(record, context)
    const { node: second } = await importCanvasHistory(record, context)
    const state = useEditorStore.getState()
    expect(mocks.read).toHaveBeenCalledWith({ historyId: 'task:o3', objectKey: 'owned-result' }, { ownerId: 'anonymous', signal: context.signal })
    expect(state.project?.assets[first.assetId]).toMatchObject({ width: 1600, height: 900, objectKey: 'owned-result', url: `/__aigc_asset__/${first.assetId}` })
    expect(first.assetId).toBe(second.assetId)
    expect(first.id).not.toBe(second.id)
    expect(first.x !== second.x || first.y !== second.y).toBe(true)
    expect(Object.keys(state.project!.assets)).toHaveLength(1)
    expect(state.undoStack).toHaveLength(2)
  })

  it('视口中心落在画板外时，新图片仍完整落在画板内', async () => {
    const file = new File([blob], '图片.png', { type: 'image/png' })
    const { node } = await importCanvasFile(file, { ...context, center: { x: 500, y: 900 } })
    expect(node.x).toBeGreaterThanOrEqual(0)
    expect(node.y).toBeGreaterThanOrEqual(0)
    expect(node.x + node.width).toBeLessThanOrEqual(1280)
    expect(node.y + node.height).toBeLessThanOrEqual(720)
  })

  it('读取历史失败不插入空节点或修改撤销栈', async () => {
    mocks.read.mockRejectedValueOnce(new Error('原图不可用'))
    await expect(importCanvasHistory(record, context)).rejects.toThrow('原图不可用')
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
    expect(useEditorStore.getState().undoStack).toEqual([])
  })

  it('上传期间项目已切换，旧图片不会进入新项目', async () => {
    mocks.upload.mockImplementationOnce(async () => {
      useEditorStore.getState().createProject('新项目')
      return { name: '旧图片', url: 'data:image/png;base64,aW1hZ2U=', width: 100, height: 100 }
    })
    await expect(importCanvasFile(new File([blob], '图片.png'), context)).rejects.toThrow('项目已切换')
    expect(useEditorStore.getState().project?.assets).toEqual({})
  })

  it('已取消操作与只读页面均不读取图片', async () => {
    const aborted = new AbortController()
    aborted.abort()
    await expect(importCanvasHistory(record, { ...context, signal: aborted.signal })).rejects.toMatchObject({ name: 'AbortError' })
    usePersistenceStore.setState({ writable: false })
    await expect(importCanvasHistory(record, context)).rejects.toThrow('编辑权')
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
