// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ request: vi.fn(), flush: vi.fn(), backup: vi.fn(), upload: vi.fn(), access: vi.fn() }))
vi.mock('./client', () => ({ cloudEnabled: true, cloudRequest: mocks.request, CloudError: class extends Error { constructor(public status: number, message: string) { super(message) } } }))
vi.mock('./assets', () => ({ uploadCloudImage: mocks.upload, accessAssets: mocks.access, assetPlaceholder: (id: string) => `/__aigc_asset__/${id}`, hydrateAssets: async (value: unknown) => value }))
vi.mock('@/editor/persistence/database', () => ({ saveConflictSnapshot: mocks.backup }))
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
})
