// @vitest-environment jsdom
import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { useEditorStore } from '@/editor/store'
import type { ImageNode } from '@/editor/types'
import * as database from './database'
import { usePersistenceStore } from './persistenceStore'
import { defaultDrafts } from './types'
import {
  EDIT_LOCK_CHANNEL,
  YIELD_TIMEOUT_MS,
  acquireEditLock,
  currentSnapshot,
  flushProject,
  initializePersistence,
  reclaimEditAccess,
  releaseEditLock,
} from './projectPersistence'

const LOCK_NAME = 'pixel-aigc-current-project:anonymous'

class TestBroadcastChannel {
  private static readonly channels = new Map<string, Set<TestBroadcastChannel>>()
  private readonly listeners = new Set<(event: MessageEvent) => void>()
  onmessage: ((event: MessageEvent) => void) | null = null

  constructor(private readonly name: string) {
    const group = TestBroadcastChannel.channels.get(name) ?? new Set()
    group.add(this)
    TestBroadcastChannel.channels.set(name, group)
  }

  postMessage(data: unknown) {
    const event = { data } as MessageEvent
    for (const channel of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel === this) continue
      queueMicrotask(() => {
        channel.onmessage?.(event)
        for (const listener of channel.listeners) listener(event)
      })
    }
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') this.listeners.add(listener)
  }

  removeEventListener(type: string, listener: (event: MessageEvent) => void) {
    if (type === 'message') this.listeners.delete(listener)
  }

  close() {
    TestBroadcastChannel.channels.get(this.name)?.delete(this)
  }
}

vi.stubGlobal('BroadcastChannel', TestBroadcastChannel)

function createLockManager() {
  const held = new Map<string, { release: () => void }>()
  const request = vi.fn((name: string, options: { ifAvailable?: boolean; steal?: boolean }, callback: (lock: { name: string } | null) => unknown) => {
    if (options?.steal && options?.ifAvailable) throw new TypeError('不能同时 steal 和 ifAvailable')
    const current = held.get(name)
    if (options?.steal && current) {
      held.delete(name)
      current.release()
    } else if (current && !options?.steal) {
      if (options?.ifAvailable) return Promise.resolve(callback(null))
      throw new Error(`测试锁未实现排队：${name}`)
    }
    let settled = false
    const record = {
      release: () => {
        if (settled) return
        settled = true
        if (held.get(name) === record) held.delete(name)
      },
    }
    held.set(name, record)
    return Promise.resolve(callback({ name })).finally(() => { record.release() })
  })
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } })
  return { request, held }
}

async function holdExternally(name: string) {
  const manager = navigator.locks
  if (!manager) throw new Error('测试环境缺少编辑锁')
  let releaseHold: (() => void) | undefined
  let ready!: () => void
  const opened = new Promise<void>((resolve) => { ready = resolve })
  const pending = manager.request(name, {}, async () => {
    ready()
    await new Promise<void>((resolve) => { releaseHold = resolve })
  })
  await opened
  return {
    pending,
    release: () => { releaseHold?.() },
  }
}

let locks: ReturnType<typeof createLockManager>

beforeEach(async () => {
  locks = createLockManager()
  await releaseEditLock()
  await database.databaseOperation('projects', 'readwrite', (store) => store.clear())
  usePersistenceStore.setState({
    phase: 'idle', writable: false, lockPhase: 'idle', status: 'saved', error: undefined, raw: undefined,
    drafts: defaultDrafts(), recoveries: {}, cloud: undefined,
  })
  useEditorStore.setState({ project: null, undoStack: [], redoStack: [] })
  await initializePersistence()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('画布编辑锁', () => {
  it('读取存档不申请锁，其他页面因此不会占住编辑权', async () => {
    expect(locks.request).not.toHaveBeenCalled()
    expect(usePersistenceStore.getState()).toMatchObject({ phase: 'ready', writable: false, lockPhase: 'idle' })
    await flushProject()
    expect(usePersistenceStore.getState().status).not.toBe('error')
  })

  it('没有编辑锁时只读取可压缩存档，不写回 IndexedDB', async () => {
    await acquireEditLock()
    useEditorStore.getState().createProject('压缩前')
    const snapshot = currentSnapshot()
    const payload = `data:image/png;base64,${'Q'.repeat(800)}`
    const scene = snapshot.project.document.scenes[0]
    const node = (id: string, assetId: string, x: number): ImageNode => ({
      id, type: 'image', assetId, name: id, x, y: 10, width: 40, height: 30, rotation: 0, opacity: 1, visible: true, locked: false, zIndex: 1,
    })
    snapshot.project.assets['keep-a'] = createImageAsset({ id: 'keep-a', name: 'keep-a', url: payload, width: 40, height: 30 })
    snapshot.project.assets['keep-b'] = createImageAsset({ id: 'keep-b', name: 'keep-b', url: payload, width: 40, height: 30 })
    scene.nodes = [node('n1', 'keep-a', 10), node('n2', 'keep-b', 80)]
    await releaseEditLock()
    const write = vi.spyOn(database, 'writeCurrentSnapshot')
    await database.writeCurrentSnapshot(snapshot)
    write.mockClear()
    await initializePersistence()
    expect(write).not.toHaveBeenCalled()
    const stored = JSON.stringify(await database.readCurrentSnapshot())
    expect(stored.split(payload).length - 1).toBe(2)
    expect(useEditorStore.getState().project?.document.scenes[0].nodes.map(item => item.id)).toEqual(['n1', 'n2'])
    write.mockRestore()
  })

  it('申请编辑权使用 ifAvailable，离开后锁释放，下一次还能取得', async () => {
    expect(await acquireEditLock()).toBe(true)
    expect(locks.request).toHaveBeenCalledWith(LOCK_NAME, { ifAvailable: true }, expect.any(Function))
    expect(usePersistenceStore.getState()).toMatchObject({ writable: true, lockPhase: 'held' })
    expect(locks.held.has(LOCK_NAME)).toBe(true)
    await releaseEditLock()
    expect(usePersistenceStore.getState()).toMatchObject({ writable: false, lockPhase: 'idle' })
    expect(locks.held.has(LOCK_NAME)).toBe(false)
    locks.request.mockClear()
    expect(await acquireEditLock()).toBe(true)
    expect(locks.request).toHaveBeenCalledWith(LOCK_NAME, { ifAvailable: true }, expect.any(Function))
  })

  it('锁被占用时不抢占，并标记为其他页面正在编辑', async () => {
    const external = await holdExternally(LOCK_NAME)
    expect(await acquireEditLock()).toBe(false)
    expect(locks.request).toHaveBeenCalledWith(LOCK_NAME, { ifAvailable: true }, expect.any(Function))
    expect(locks.request).not.toHaveBeenCalledWith(LOCK_NAME, { steal: true }, expect.any(Function))
    expect(usePersistenceStore.getState()).toMatchObject({ writable: false, lockPhase: 'blocked' })
    expect(locks.held.has(LOCK_NAME)).toBe(true)
    external.release()
  })

  it('收到让出请求时先保存未写入的修改，再变为只读并放开锁', async () => {
    await acquireEditLock()
    useEditorStore.getState().createProject('原名')
    await flushProject()
    useEditorStore.setState((state) => ({
      project: state.project ? { ...state.project, name: '让出前已改', updatedAt: new Date().toISOString() } : null,
    }))
    const peer = new BroadcastChannel(EDIT_LOCK_CHANNEL)
    const yielded = new Promise<{ type?: string; scope?: string; requestId?: string }>((resolve) => {
      peer.onmessage = (event: MessageEvent) => {
        if (event.data?.type === 'yielded') resolve(event.data)
      }
    })
    peer.postMessage({ type: 'yield', scope: 'anonymous', requestId: 'req-yield' })
    await yielded
    expect(usePersistenceStore.getState()).toMatchObject({ writable: false, lockPhase: 'blocked' })
    expect(await database.readCurrentSnapshot()).toMatchObject({ project: { name: '让出前已改' } })
    expect(locks.held.has(LOCK_NAME)).toBe(false)
    peer.close()
  })

  it('其他账号的让出请求不会放下当前编辑锁', async () => {
    await acquireEditLock()
    const peer = new BroadcastChannel(EDIT_LOCK_CHANNEL)
    peer.postMessage({ type: 'yield', scope: 'someone-else', requestId: 'other' })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(usePersistenceStore.getState()).toMatchObject({ writable: true, lockPhase: 'held' })
    expect(locks.held.has(LOCK_NAME)).toBe(true)
    peer.close()
  })

  it('重新取得编辑权会先等对方保存，再用 steal 抢锁并读到新存档', async () => {
    await acquireEditLock()
    useEditorStore.getState().createProject('版本A')
    await flushProject()
    const newer = structuredClone(currentSnapshot())
    newer.project.name = '版本B'
    await releaseEditLock()
    expect(useEditorStore.getState().project?.name).toBe('版本A')
    const external = await holdExternally(LOCK_NAME)
    const peer = new BroadcastChannel(EDIT_LOCK_CHANNEL)
    peer.onmessage = (event: MessageEvent) => {
      if (event.data?.type !== 'yield') return
      void database.writeCurrentSnapshot(newer).then(() => {
        peer.postMessage({ type: 'yielded', scope: event.data.scope, requestId: event.data.requestId })
      })
    }
    locks.request.mockClear()
    await reclaimEditAccess()
    expect(locks.request).toHaveBeenCalledWith(LOCK_NAME, { steal: true }, expect.any(Function))
    expect(useEditorStore.getState().project?.name).toBe('版本B')
    expect(usePersistenceStore.getState()).toMatchObject({ phase: 'ready', writable: true, lockPhase: 'held' })
    expect(await database.readCurrentSnapshot()).toMatchObject({ project: { name: '版本B' } })
    external.release()
    peer.close()
  })

  it('对方没有回应时超时后仍 steal 抢锁', async () => {
    const external = await holdExternally(LOCK_NAME)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const pending = reclaimEditAccess()
    await vi.advanceTimersByTimeAsync(YIELD_TIMEOUT_MS)
    await pending
    expect(locks.request).toHaveBeenCalledWith(LOCK_NAME, { steal: true }, expect.any(Function))
    expect(usePersistenceStore.getState()).toMatchObject({ writable: true, lockPhase: 'held' })
    external.release()
  })

  it('离开画布时会先把未保存修改写入再释放锁', async () => {
    await acquireEditLock()
    useEditorStore.getState().createProject('待保存')
    useEditorStore.setState((state) => ({
      project: state.project ? { ...state.project, name: '离开前保存' } : null,
    }))
    await releaseEditLock()
    expect(await database.readCurrentSnapshot()).toMatchObject({ project: { name: '离开前保存' } })
    expect(locks.held.has(LOCK_NAME)).toBe(false)
  })
})
