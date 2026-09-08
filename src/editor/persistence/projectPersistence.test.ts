// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import * as database from './database'
import { defaultDrafts } from './types'
import { usePersistenceStore } from './persistenceStore'
import { currentSnapshot, flushProject, initializePersistence, newProject, replaceSnapshot } from './projectPersistence'

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
    usePersistenceStore.getState().setDrafts({ ...defaultDrafts(), 'text-to-video': { prompt: '视频草稿', count: 1, presetKey: '16:9', durationSeconds: 10 } })
    const expected = currentSnapshot()
    await flushProject()
    expect(await database.readCurrentSnapshot()).toEqual(expected)
    useEditorStore.setState({ project: null })
    await initializePersistence()
    expect(useEditorStore.getState().project).toEqual(expected.project)
    expect(usePersistenceStore.getState().drafts).toEqual(expected.drafts)
    expect(useEditorStore.getState().undoStack).toEqual([])
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
    expect(await database.readCurrentSnapshot()).toEqual(currentSnapshot())
  })

  it('损坏本地数据进入恢复页，不静默创建或覆盖项目', async () => {
    await database.writeCurrentSnapshot({ schemaVersion: 99 })
    await initializePersistence()
    expect(usePersistenceStore.getState().phase).toBe('error')
    expect(usePersistenceStore.getState().raw).toEqual({ schemaVersion: 99 })
    expect(await database.readCurrentSnapshot()).toEqual({ schemaVersion: 99 })
  })
})
