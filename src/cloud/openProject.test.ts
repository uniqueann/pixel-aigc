// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useEditorStore } from '@/editor/store'
import { defaultDrafts, type ProjectSnapshot } from '@/editor/persistence/types'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { databaseOperation, readCurrentSnapshot, readSavedProjectSnapshot, setPersistenceUser, writeCurrentSnapshot } from '@/editor/persistence/database'
import { useUserStore } from '@/store/useUserStore'
import type { CloudProject } from '@shared/cloud'
import { draftsSchema } from '@shared/cloud'
import { readRecentWork } from '@/features/dashboard/recentWork'
import { openCloudProject, openLocalProject, useCloudStore } from './sync'

const mocks = vi.hoisted(() => ({ request: vi.fn() }))
vi.mock('./client', () => ({ authEnabled: true, cloudEnabled: true, cloudRequest: mocks.request,
  CloudError: class extends Error { constructor(public status: number, message: string, public code = 'REQUEST_FAILED') { super(message) } },
}))

const OWNER_A = '11111111-1111-4111-8111-111111111111'
const OWNER_B = '22222222-2222-4222-8222-222222222222'
// jsdom 的取消信号缺少新版浏览器已有的同步检查方法。
Object.defineProperty(AbortSignal.prototype, 'throwIfAborted', { configurable: true, value() { if (this.aborted) throw this.reason } })
function snapshot(id: string): ProjectSnapshot {
  return { schemaVersion: 1, drafts: defaultDrafts(), recoveries: {}, project: {
    id, name: `画布${id}`, createdAt: '2026-10-05T01:00:00Z', updatedAt: '2026-10-05T01:00:00Z', assets: {}, generations: {},
    document: { version: 1, activeSceneId: '场景', scenes: [{ id: '场景', name: '场景', width: 1280, height: 720, nodes: [], viewport: { zoom: 1, panX: 0, panY: 0 } }] },
  } }
}
function remote(id = '远端'): CloudProject {
  const local = snapshot(id)
  return { id, name: local.project.name, schemaVersion: 1, document: local.project.document, drafts: draftsSchema.parse(local.drafts), assets: [], revision: 2,
    createdAt: local.project.createdAt, updatedAt: local.project.updatedAt }
}

beforeEach(async () => {
  mocks.request.mockReset()
  localStorage.clear()
  await databaseOperation('projects', 'readwrite', store => store.clear())
  setPersistenceUser(OWNER_A)
  useUserStore.setState({ userId: OWNER_A })
  usePersistenceStore.setState({ ownerId: OWNER_A, phase: 'ready', writable: true, status: 'saved', error: undefined, cloud: undefined, recoveries: {}, drafts: defaultDrafts() })
  useCloudStore.setState({ busy: false, error: undefined })
  useEditorStore.getState().loadProject(snapshot('当前').project)
  await writeCurrentSnapshot(snapshot('当前'))
})
afterEach(() => vi.restoreAllMocks())

describe('首页画布恢复与取消', () => {
  it('恢复本机存档及草稿，同时保留当前项目，按账号隔离', async () => {
    const other = snapshot('本机')
    other.drafts['text-to-image'].prompt = '本机草稿'
    await databaseOperation('projects', 'readwrite', store => store.put(other, `${OWNER_A}:project:本机`))
    await openLocalProject('本机', { expectedUserId: OWNER_A })
    expect(useEditorStore.getState().project?.id).toBe('本机')
    expect(usePersistenceStore.getState().drafts['text-to-image'].prompt).toBe('本机草稿')
    expect(await readSavedProjectSnapshot('当前', OWNER_A)).toMatchObject({ project: { id: '当前' } })
    expect(await readSavedProjectSnapshot('本机', OWNER_B)).toBeUndefined()
    expect(readRecentWork(OWNER_A).projects.map(item => item.id)).toContain('本机')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('首次打开云端项目不会创建示例项目或调用新增接口', async () => {
    useEditorStore.setState({ project: null })
    mocks.request.mockResolvedValue(remote())
    await openCloudProject('远端', { expectedUserId: OWNER_A })
    expect(useEditorStore.getState().project?.id).toBe('远端')
    expect(usePersistenceStore.getState().cloud).toMatchObject({ revision: 2, pending: false })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request).toHaveBeenCalledWith('/projects/%E8%BF%9C%E7%AB%AF', 'GET', undefined, { expectedUserId: OWNER_A, signal: undefined })
  })

  it.each(['取消', '换号', '内容变化'] as const)('慢响应后%s不会覆盖当前画布', async reason => {
    let resolve!: (value: CloudProject) => void
    mocks.request.mockReturnValue(new Promise(done => { resolve = done }))
    const controller = new AbortController()
    const opening = openCloudProject('远端', { expectedUserId: OWNER_A, signal: controller.signal })
    const result = opening.then(() => undefined, error => error as Error)
    await vi.waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(1))
    if (reason === '取消') controller.abort(new Error('用户取消'))
    if (reason === '换号') {
      setPersistenceUser(OWNER_B); useUserStore.setState({ userId: OWNER_B }); usePersistenceStore.setState({ ownerId: OWNER_B })
      useEditorStore.getState().loadProject(snapshot('乙账号').project)
    }
    if (reason === '内容变化') useEditorStore.getState().setViewport({ zoom: 2, panX: 10, panY: 20 })
    resolve(remote())
    expect(await result).toBeInstanceOf(Error)
    expect(useEditorStore.getState().project?.id).toBe(reason === '换号' ? '乙账号' : '当前')
    expect(await readSavedProjectSnapshot('远端', OWNER_A)).toBeUndefined()
    expect(useCloudStore.getState().busy).toBe(false)
  })

  it('读取失败或编号不符保留本机内容，解除忙状态后允许重试', async () => {
    mocks.request.mockRejectedValueOnce(new Error('项目不存在')).mockResolvedValueOnce(remote('错误编号')).mockResolvedValueOnce(remote())
    await expect(openCloudProject('远端')).rejects.toThrow('项目不存在')
    await expect(openCloudProject('远端')).rejects.toThrow('编号不一致')
    expect(useEditorStore.getState().project?.id).toBe('当前')
    await openCloudProject('远端')
    expect(useEditorStore.getState().project?.id).toBe('远端')
  })

  it('本机存储失败时不会替换当前项目', async () => {
    mocks.request.mockResolvedValue(remote())
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      if ((value as ProjectSnapshot)?.project?.id === '远端') throw new DOMException('空间不足', 'QuotaExceededError')
      return original.call(this, value, key)
    })
    await expect(openCloudProject('远端')).rejects.toThrow('空间不足')
    expect(useEditorStore.getState().project?.id).toBe('当前')
    expect(await readCurrentSnapshot()).toMatchObject({ project: { id: '当前' } })
  })

  it('取消保存回滚当前记录与项目存档，不能只保存其中一条', async () => {
    const controller = new AbortController(), original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key)
      if (key === `${OWNER_A}:current`) queueMicrotask(() => controller.abort(new Error('取消写入')))
      return request
    })
    await expect(writeCurrentSnapshot(snapshot('待取消'), controller.signal)).rejects.toThrow('取消写入')
    expect(await readCurrentSnapshot()).toMatchObject({ project: { id: '当前' } })
    expect(await readSavedProjectSnapshot('待取消')).toBeUndefined()
    expect(readRecentWork(OWNER_A).projects.some(item => item.id === '待取消')).toBe(false)
  })

  it('事务提交期间登录身份改变时保留原账号存档，不覆盖新账号编辑器或状态', async () => {
    mocks.request.mockResolvedValue(remote())
    const original = IDBObjectStore.prototype.put
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value, key) {
      const request = original.call(this, value, key)
      if (key === `${OWNER_A}:current` && (value as ProjectSnapshot).project.id === '远端') queueMicrotask(() => {
        useUserStore.setState({ userId: OWNER_B })
        usePersistenceStore.setState({ ownerId: OWNER_B, phase: 'ready', status: 'saved' })
        useEditorStore.getState().loadProject(snapshot('乙账号').project)
      })
      return request
    })
    await expect(openCloudProject('远端', { expectedUserId: OWNER_A })).rejects.toThrow('账号已切换')
    expect(useEditorStore.getState().project?.id).toBe('乙账号')
    expect(usePersistenceStore.getState()).toMatchObject({ ownerId: OWNER_B, phase: 'ready', status: 'saved' })
    expect(await readSavedProjectSnapshot('远端', OWNER_A)).toMatchObject({ project: { id: '远端' } })
    expect(await readSavedProjectSnapshot('远端', OWNER_B)).toBeUndefined()
  })
})
