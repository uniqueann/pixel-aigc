// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AddNodeCommand } from '@/editor/commands'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import type { ImageNode } from '@/editor/types'
import { Capability } from '@/types'
import * as database from './database'
import { defaultDrafts, type ProjectSnapshot } from './types'
import { usePersistenceStore } from './persistenceStore'
import { currentSnapshot, flushProject, initializePersistence, newProject, replaceSnapshot, updateRuntimeAssetAccess } from './projectPersistence'

Object.defineProperty(navigator, 'locks', { configurable: true, value: { request: (_name: string, _options: unknown, callback: (lock: object) => Promise<void>) => callback({}) } })

beforeEach(async () => {
  vi.restoreAllMocks()
  await database.databaseOperation('projects', 'readwrite', (store) => store.clear())
  usePersistenceStore.setState({ phase: 'idle', writable: true, drafts: defaultDrafts(), recoveries: {} })
  useEditorStore.setState({ project: null })
  await initializePersistence()
  useEditorStore.getState().createProject('持久化测试')
})

describe('IndexedDB 项目保存与恢复', () => {
  it('事务提交后保存完整快照，再初始化恢复相同项目和空历史', async () => {
    usePersistenceStore.getState().setDrafts({ ...defaultDrafts(),
      'text-to-image': { prompt: '文生图草稿', count: 2, presetKey: '16:9', durationSeconds: 5, modelProfileId: 'chosen-model', resolution: '4k' },
      'text-to-video': { prompt: '视频草稿', count: 1, presetKey: '16:9', durationSeconds: 10 },
    })
    const expected = currentSnapshot()
    await flushProject()
    expect(await database.readCurrentSnapshot()).toEqual(expected)
    useEditorStore.setState({ project: null })
    await initializePersistence()
    expect(useEditorStore.getState().project).toEqual(expected.project)
    expect(usePersistenceStore.getState().drafts).toEqual(expected.drafts)
    expect(useEditorStore.getState().undoStack).toEqual([])
  })

  it('撤销栈随当前项目保存，刷新后仍可撤销与重做', async () => {
    const state = useEditorStore.getState()
    const sceneId = state.activeSceneId!
    const asset = createImageAsset({ id: 'persist-asset', name: 'mug.jpg', url: 'data:image/png;base64,aa', width: 40, height: 30 })
    const node: ImageNode = {
      id: 'persist-node', type: 'image', assetId: asset.id, name: asset.name,
      x: 10, y: 20, width: 40, height: 30, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 0,
    }
    state.registerAsset(asset)
    state.executeCommand(new AddNodeCommand(sceneId, node))
    await flushProject()
    useEditorStore.setState({ project: null, undoStack: [], redoStack: [] })
    await initializePersistence()
    expect(useEditorStore.getState().undoStack).toHaveLength(1)
    useEditorStore.getState().undo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
    expect(useEditorStore.getState().redoStack).toHaveLength(1)
    useEditorStore.getState().redo()
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toMatchObject([{ id: 'persist-node' }])
  })

  it('连续保存串行处理，最终保留最新版本', async () => {
    const first = flushProject()
    useEditorStore.getState().setViewport({ zoom: 0.6, panX: 10, panY: 20 })
    const second = flushProject()
    await Promise.all([first, second])
    expect(await database.readCurrentSnapshot()).toEqual(currentSnapshot())
    expect(usePersistenceStore.getState().status).toBe('saved')
  })

  it('保存失败不覆盖上次存档，修复后可继续保存', async () => {
    await flushProject()
    const previous = await database.readCurrentSnapshot()
    useEditorStore.getState().setViewport({ zoom: 2, panX: 15, panY: 30 })
    const failure = vi.spyOn(database, 'writeCurrentSnapshot').mockRejectedValueOnce(new Error('存储空间不足'))
    await expect(flushProject()).rejects.toThrow('存储空间不足')
    expect(usePersistenceStore.getState().status).toBe('error')
    expect(await database.readCurrentSnapshot()).toEqual(previous)
    failure.mockRestore()
    await flushProject()
    expect(await database.readCurrentSnapshot()).toEqual(currentSnapshot())
  })

  it('500 毫秒防抖自动保存，未到时间不会提前写入', async () => {
    await flushProject()
    vi.useFakeTimers()
    const write = vi.spyOn(database, 'writeCurrentSnapshot').mockResolvedValue('current')
    useEditorStore.getState().setViewport({ zoom: 3, panX: 0, panY: 0 })
    await vi.advanceTimersByTimeAsync(499)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    vi.useRealTimers()
    await flushProject()
    expect(write).toHaveBeenCalled()
  })

  it('拒绝损坏导入并保留项目，新建成功后使用空白场景和新 ID', async () => {
    await flushProject()
    const original = currentSnapshot()
    await expect(replaceSnapshot({ ...original, schemaVersion: 2 } as never)).rejects.toThrow('版本')
    expect(currentSnapshot()).toEqual(original)
    await newProject()
    expect(useEditorStore.getState().project?.id).not.toBe(original.project.id)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes).toEqual([])
    expect(usePersistenceStore.getState().drafts['text-to-image'].modelProfileId).toBeUndefined()
    expect(usePersistenceStore.getState().drafts['text-to-image'].resolution).toBeUndefined()
    expect(await database.readCurrentSnapshot()).toEqual(currentSnapshot())
  })

  it('再次打开时去掉重复和无人引用的内嵌图，画布节点保持不变', async () => {
    const current = currentSnapshot()
    const payload = `data:image/png;base64,${'Q'.repeat(4000)}`
    const orphan = `data:image/png;base64,${'Z'.repeat(2500)}`
    const scene = current.project.document.scenes[0]
    const node = (id: string, assetId: string, x: number): ImageNode => ({
      id, type: 'image', assetId, name: id, x, y: 10, width: 40, height: 30, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1,
    })
    current.project.assets['keep-a'] = createImageAsset({ id: 'keep-a', name: 'keep-a', url: payload, width: 40, height: 30 })
    current.project.assets['keep-b'] = createImageAsset({ id: 'keep-b', name: 'keep-b', url: payload, width: 40, height: 30 })
    current.project.assets.orphan = createImageAsset({ id: 'orphan', name: 'orphan', url: orphan, width: 40, height: 30, generationId: 'gen-orphan' })
    current.project.generations['gen-orphan'] = {
      id: 'gen-orphan', capability: Capability.TextToImage, status: 'succeeded', input: {},
      inputAssetIds: [], outputAssetIds: ['orphan'], createdAt: current.project.createdAt, updatedAt: current.project.updatedAt,
    }
    scene.nodes = [node('n1', 'keep-a', 10), node('n2', 'keep-b', 80)]
    await database.writeCurrentSnapshot(current)
    await initializePersistence()
    const saved = await database.readCurrentSnapshot() as ProjectSnapshot
    const json = JSON.stringify(saved)
    expect(json.split(payload).length - 1).toBe(1)
    expect(json).not.toContain(orphan)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.map(item => item.id)).toEqual(['n1', 'n2'])
    expect(useEditorStore.getState().project?.assets['keep-a'].url).toBe(payload)
    expect(useEditorStore.getState().project?.assets['keep-b'].url).toBe(payload)
  })

  it('损坏本地数据进入恢复页，不静默创建或覆盖项目', async () => {
    await database.writeCurrentSnapshot({ schemaVersion: 99 })
    await initializePersistence()
    expect(usePersistenceStore.getState().phase).toBe('error')
    expect(usePersistenceStore.getState().raw).toEqual({ schemaVersion: 99 })
    expect(await database.readCurrentSnapshot()).toEqual({ schemaVersion: 99 })
  })
})

it('签名地址刷新不产生业务编辑版本', async () => {
  useEditorStore.getState().registerAsset({ id: 'cloud-asset', name: '图', type: 'image', width: 10, height: 10, mimeType: 'image/png', source: 'upload', createdAt: '2026-01-01', url: 'https://example.com/old', storage: { provider: 'r2', projectId: useEditorStore.getState().project!.id, objectKey: 'media/test' } })
  usePersistenceStore.setState({ cloud: { revision: 4, pending: false } })
  await flushProject()
  updateRuntimeAssetAccess([{ id: 'cloud-asset', url: 'https://example.com/new', expiresAt: 1000 }])
  expect(usePersistenceStore.getState().cloud?.pending).toBe(false)
  expect(usePersistenceStore.getState().status).toBe('saved')
  expect(useEditorStore.getState().project?.assets['cloud-asset'].url).toBe('https://example.com/new')
})
