// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), flush: vi.fn(), backup: vi.fn(), upload: vi.fn(), access: vi.fn(), blob: vi.fn() }))
vi.mock('./client', () => ({ authEnabled: false, cloudEnabled: true, cloudRequest: mocks.request, CloudError: class extends Error { constructor(public status: number, message: string) { super(message) } } }))
vi.mock('./assets', () => ({ uploadCloudImage: mocks.upload, accessAssets: mocks.access, assetPlaceholder: (id: string) => `/__aigc_asset__/${id}`, hydrateAssets: async (value: unknown) => value }))
vi.mock('@/editor/persistence/database', () => ({ saveConflictSnapshot: mocks.backup }))
vi.mock('@/features/image-workstation/download', () => ({ blobFromImageSource: mocks.blob }))
vi.mock('@/editor/persistence/projectPersistence', async () => {
  const { useEditorStore } = await import('@/editor/store')
  const { usePersistenceStore } = await import('@/editor/persistence/persistenceStore')
  return { flushProject: mocks.flush, hasUnfinishedGeneration: () => false,
    currentSnapshot: () => ({ schemaVersion: 1, project: structuredClone(useEditorStore.getState().project), drafts: usePersistenceStore.getState().drafts, recoveries: {}, cloud: usePersistenceStore.getState().cloud }),
    replaceSnapshot: vi.fn(),
  }
})
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { defaultDrafts } from '@/editor/persistence/types'
import { syncProject, useCloudStore } from './sync'
import { CloudError } from './client'
import { createImageAsset } from '@/editor/services/assetService'
import type { ImageNode } from '@/editor/types'
beforeEach(() => {
  vi.clearAllMocks()
  useEditorStore.getState().createProject('测试')
  usePersistenceStore.setState({ cloud: { revision: 3, pending: true }, drafts: defaultDrafts(), recoveries: {} })
  useCloudStore.setState({ busy: false, error: undefined })
  mocks.flush.mockResolvedValue(undefined); mocks.backup.mockResolvedValue(undefined)
})
describe('云同步故障恢复', () => {
  it('并发触发共享同一写入，请求携带旧 revision', async () => {
    mocks.request.mockResolvedValue({ revision: 4 })
    await Promise.all([syncProject(),syncProject()])
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][2].baseRevision).toBe(3)
    expect(usePersistenceStore.getState().cloud).toEqual({ revision: 4, pending: false })
  })
  it('409 保存本地副本并停止覆盖，后续重试不会发送请求', async () => {
    mocks.request.mockRejectedValue(new CloudError(409,'冲突'))
    await expect(syncProject()).rejects.toThrow('冲突')
    expect(mocks.backup).toHaveBeenCalledTimes(1)
    expect(usePersistenceStore.getState().cloud?.conflict).toBe(true)
    await expect(syncProject()).rejects.toThrow('冲突')
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })
  it('网络失败保留 revision，重试成功后才标记保存', async () => {
    mocks.request.mockRejectedValueOnce(new TypeError('网络中断')).mockResolvedValueOnce({ revision: 4 })
    await expect(syncProject()).rejects.toThrow('网络中断')
    expect(usePersistenceStore.getState().cloud).toEqual({ revision: 3, pending: true })
    await syncProject()
    expect(usePersistenceStore.getState().cloud?.revision).toBe(4)
  })
  it('保存过程中新增编辑保持待同步', async () => {
    mocks.request.mockImplementationOnce(async () => {
      const project = useEditorStore.getState().project!
      useEditorStore.setState({ project: { ...project, name: '继续编辑' } })
      return { revision: 4 }
    })
    await syncProject()
    expect(usePersistenceStore.getState().cloud).toEqual({ revision: 4, pending: true })
  })

  it('私有生成图片通过对象键取得原图，云端上传保留本地血缘与裂变草稿', async () => {
    const asset = createImageAsset({ id: 'generated', name: '生成图', url: '/__aigc_asset__/generated', objectKey: 'generation-key', width: 2048, height: 1152, source: 'generation', generationId: 'generation:task' })
    const sceneId = useEditorStore.getState().activeSceneId!
    const node: ImageNode = { id: 'generated-node', type: 'image', assetId: asset.id, name: asset.name, x: 0, y: 0, width: 320, height: 180, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0 }
    useEditorStore.getState().registerAsset(asset)
    useEditorStore.getState().addNode(sceneId, node)
    usePersistenceStore.getState().setDrafts({ ...defaultDrafts(), derived: { sourceAssetId: asset.id, sourceNode: node, mode: 'variation', prompt: '', count: 2, durationSeconds: 5, modelProfileId: 'chosen-model', resolution: '2k' } })
    mocks.blob.mockResolvedValue(new Blob(['原图'], { type: 'image/png' }))
    mocks.upload.mockResolvedValue({ id: asset.id, name: asset.name, type: 'image', source: 'upload', objectKey: 'cloud-key', width: 2048, height: 1152, mimeType: 'image/png' })
    mocks.access.mockResolvedValue([{ id: asset.id, url: 'https://images.example/cloud.png', expiresAt: Date.now() + 60_000 }])
    mocks.request.mockResolvedValue({ revision: 4 })
    await syncProject()
    expect(mocks.blob).toHaveBeenCalledWith(asset.url, 'generation-key')
    expect(useEditorStore.getState().project?.assets[asset.id]).toMatchObject({ generationId: 'generation:task', source: 'generation', storage: { objectKey: 'cloud-key' } })
    expect(mocks.request.mock.calls[0][2].drafts.derived).toMatchObject({ modelProfileId: 'chosen-model', resolution: '2k', count: 2 })
  })
})
