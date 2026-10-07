import { hydrateAssets } from '@/cloud/assets'
import { authEnabled } from '@/cloud/client'
import { useEditorStore } from '@/editor/store'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import { readCurrentSnapshot, writeCurrentSnapshot, persistenceScope } from './database'
import { linkOwnedAssetKeys } from './ownedAssetKeys'
import { restoreTaskDrafts } from './restoreDrafts'
import { parseSnapshot, serializeSnapshot, persistableSnapshot, restoreHistoryCommands } from './snapshot'
import { recoveryForTask, usePersistenceStore } from './persistenceStore'
import { defaultDrafts, type ProjectSnapshot } from './types'

export const EDIT_LOCK_CHANNEL = 'pixel-aigc-edit-lock'
export const YIELD_TIMEOUT_MS = 3000

type EditLockMessage = { type: 'yield' | 'yielded'; scope: string; requestId: string }

let initialization: Promise<void> | undefined
let subscribed = false
let revision = 0
let savedRevision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let queue: Promise<unknown> = Promise.resolve()
let sessionRelease: (() => void) | undefined
let sessionFinished: Promise<void> | undefined
let hasLock = false
let wantsLock = false
let suppressChanges = false
let chain: Promise<unknown> = Promise.resolve()
let editLockBus: BroadcastChannel | undefined

export function currentSnapshot(): ProjectSnapshot {
  const editor = useEditorStore.getState()
  if (!editor.project) throw new Error('当前没有项目')
  const { drafts, recoveries, cloud } = usePersistenceStore.getState()
  return {
    schemaVersion: 1,
    project: editor.project,
    drafts,
    recoveries,
    cloud,
    history: {
      undo: editor.undoStack.map(command => command.serialize()),
      redo: editor.redoStack.map(command => command.serialize()),
    },
  }
}

export async function copyProjectLocally() {
  if (hasUnfinishedGeneration()) throw new Error('请先等待当前生成完成')
  await flushProject()
  const copy = parseSnapshot(currentSnapshot())
  copy.project.id = crypto.randomUUID()
  copy.project.name = `${copy.project.name.slice(0, 80)}（本地副本）`
  copy.cloud = undefined
  for (const record of Object.values(copy.recoveries)) record.projectId = copy.project.id
  await replaceSnapshot(copy)
}

function changed() {
  if (suppressChanges || usePersistenceStore.getState().phase !== 'ready' || !usePersistenceStore.getState().writable) return
  revision += 1
  const cloud = usePersistenceStore.getState().cloud
  if (cloud && !cloud.pending) usePersistenceStore.setState({ cloud: { ...cloud, pending: true } })
  usePersistenceStore.setState({ status: 'dirty' })
  clearTimeout(timer)
  timer = setTimeout(() => { void flushProject().catch(() => undefined) }, 500)
}

export function flushProject(): Promise<void> {
  if (usePersistenceStore.getState().phase === 'idle') return Promise.resolve()
  clearTimeout(timer)
  const operation = queue.catch(() => undefined).then(async () => {
    const state = usePersistenceStore.getState()
    if (!state.writable || state.phase !== 'ready') {
      if (!state.writable && state.phase === 'ready' && revision === savedRevision) return
      throw new Error('当前页面没有项目编辑权')
    }
    if (!useEditorStore.getState().project) return
    const savingRevision = revision
    const snapshot = parseSnapshot(currentSnapshot())
    usePersistenceStore.setState({ status: 'saving' })
    await writeCurrentSnapshot(persistableSnapshot(snapshot))
    savedRevision = savingRevision
    usePersistenceStore.setState({ status: revision === savedRevision ? 'saved' : 'dirty', error: undefined })
  }).catch((error: unknown) => {
    usePersistenceStore.setState({ status: 'error', error: error instanceof Error ? error.message : '保存失败' })
    throw error
  })
  queue = operation
  return operation
}

function installSubscriptions() {
  if (subscribed) return
  subscribed = true
  useEditorStore.subscribe((state, previous) => {
    if (state.project !== previous.project || state.undoStack !== previous.undoStack || state.redoStack !== previous.redoStack) changed()
  })
  usePersistenceStore.subscribe((state, previous) => {
    if (state.drafts !== previous.drafts || state.recoveries !== previous.recoveries) changed()
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && revision !== savedRevision) void flushProject().catch(() => undefined)
  })
  window.addEventListener('beforeunload', (event) => {
    if (revision !== savedRevision) { event.preventDefault(); event.returnValue = '' }
  })
  window.addEventListener('pagehide', () => {
    const release = sessionRelease
    hasLock = false
    sessionRelease = undefined
    sessionFinished = undefined
    release?.()
  })
  editLockChannel()
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload()
  })
  useUserStore.subscribe((state, previous) => {
    if (state.userId !== previous.userId) void relinkOwnedKeys()
  })
}

function withDisplayableCloudBytes(compact: ProjectSnapshot, source: ProjectSnapshot) {
  const display = parseSnapshot(compact)
  for (const [id, asset] of Object.entries(display.project.assets)) {
    const previous = source.project.assets[id]
    if (previous?.url.startsWith('data:') && asset.url.startsWith('/__aigc_asset__/')) asset.url = previous.url
  }
  return display
}

async function relinkOwnedKeys() {
  const projectId = useEditorStore.getState().project?.id
  if (!projectId || usePersistenceStore.getState().phase !== 'ready') return
  try {
    const linked = await linkOwnedAssetKeys(parseSnapshot(currentSnapshot()))
    if (useEditorStore.getState().project?.id !== projectId) return
    useEditorStore.setState(state => {
      if (!state.project || state.project.id !== projectId) return state
      const assets = { ...state.project.assets }
      let gained = false
      for (const asset of Object.values(linked.project.assets)) {
        const live = assets[asset.id]
        if (!live || !asset.objectKey || live.objectKey || live.storage?.objectKey) continue
        assets[asset.id] = { ...live, objectKey: asset.objectKey }
        gained = true
      }
      if (!gained) return state
      return { project: { ...state.project, assets, updatedAt: new Date().toISOString() } }
    })
  } catch {
    // 匹配失败时保留现有存档。
  }
}

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.catch(() => undefined).then(task)
  chain = run
  return run
}

function lockName() {
  return `pixel-aigc-current-project:${persistenceScope()}`
}

function isEditLockMessage(value: unknown): value is EditLockMessage {
  if (!value || typeof value !== 'object') return false
  const data = value as Partial<EditLockMessage>
  return (data.type === 'yield' || data.type === 'yielded') && typeof data.scope === 'string' && typeof data.requestId === 'string'
}

/** 同一来源的标签页用来交接编辑锁。消息不会回声给发送方。 */
function editLockChannel() {
  if (typeof BroadcastChannel === 'undefined') return undefined
  if (!editLockBus) {
    editLockBus = new BroadcastChannel(EDIT_LOCK_CHANNEL)
    editLockBus.onmessage = (event: MessageEvent) => {
      if (!isEditLockMessage(event.data) || event.data.scope !== persistenceScope() || event.data.type !== 'yield') return
      const requestId = event.data.requestId
      void enqueue(async () => {
        if (!hasLock) return
        await releaseHeldLock('blocked')
        editLockBus?.postMessage({ type: 'yielded', scope: persistenceScope(), requestId })
      })
    }
  }
  return editLockBus
}

function notifyPeerToFlush() {
  const bus = editLockChannel()
  if (!bus) return Promise.resolve()
  const channel = bus
  const requestId = crypto.randomUUID()
  const scope = persistenceScope()
  return new Promise<void>((resolve) => {
    const timeout = setTimeout(finish, YIELD_TIMEOUT_MS)
    const onMessage = (event: MessageEvent) => {
      if (!isEditLockMessage(event.data)) return
      if (event.data.type === 'yielded' && event.data.scope === scope && event.data.requestId === requestId) finish()
    }
    function finish() {
      clearTimeout(timeout)
      channel.removeEventListener('message', onMessage)
      resolve()
    }
    bus.addEventListener('message', onMessage)
    bus.postMessage({ type: 'yield', scope, requestId })
  })
}

async function releaseHeldLock(next: 'idle' | 'blocked') {
  const release = sessionRelease
  const finished = sessionFinished
  if (!hasLock || !release) {
    hasLock = false
    usePersistenceStore.setState({ writable: false, lockPhase: next })
    return
  }
  try {
    if (usePersistenceStore.getState().phase === 'ready' && useEditorStore.getState().project) await flushProject()
  } catch {
    // 让出编辑权时保留已经写入的存档，不能继续占着锁。
  }
  if (sessionRelease !== release) return
  hasLock = false
  sessionRelease = undefined
  sessionFinished = undefined
  usePersistenceStore.setState({ writable: false, lockPhase: next })
  release()
  await finished
}

function requestBrowserLock(steal: boolean) {
  const locks = navigator.locks
  if (!locks) return Promise.reject(new Error('此浏览器不支持安全的本地项目编辑锁，请使用新版浏览器'))
  return new Promise<boolean>((resolve, reject) => {
    void locks.request(lockName(), steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(false); return }
      hasLock = true
      let release!: () => void
      let markFinished!: () => void
      const held = new Promise<void>((done) => { release = done })
      sessionFinished = new Promise<void>((done) => { markFinished = done })
      sessionRelease = release
      usePersistenceStore.setState({ writable: true, lockPhase: 'held' })
      resolve(true)
      await held
      if (sessionRelease === release) {
        sessionRelease = undefined
        hasLock = false
      }
      markFinished()
    }).catch(reject)
  })
}

async function requestEditLock(steal: boolean) {
  if (!wantsLock) return false
  if (hasLock) {
    usePersistenceStore.setState({ writable: true, lockPhase: 'held' })
    return true
  }
  usePersistenceStore.setState({ lockPhase: 'acquiring' })
  if (steal) await notifyPeerToFlush()
  if (!wantsLock) {
    usePersistenceStore.setState({ writable: false, lockPhase: 'idle' })
    return false
  }
  if (hasLock) return true
  const granted = await requestBrowserLock(steal)
  if (!wantsLock) {
    if (hasLock) await releaseHeldLock('idle')
    return false
  }
  if (!granted) {
    usePersistenceStore.setState({ writable: false, lockPhase: 'blocked' })
    return false
  }
  return true
}

/** 画布路由进入时调用。已有持有者时只返回 false，不会抢锁。 */
export function acquireEditLock() {
  wantsLock = true
  editLockChannel()
  return enqueue(() => requestEditLock(false))
}

/** 离开画布路由时调用：先保存，再放开浏览器锁。 */
export function releaseEditLock() {
  wantsLock = false
  return enqueue(() => releaseHeldLock('idle'))
}

async function readAndApply(compactAllowed: boolean) {
  const raw = await readCurrentSnapshot()
  usePersistenceStore.setState({ raw, writable: hasLock })
  if (raw === undefined) return
  const parsed = parseSnapshot(raw)
  const linked = await linkOwnedAssetKeys(parsed)
  const compact = persistableSnapshot(linked)
  if (compactAllowed && hasLock && JSON.stringify(compact).length < JSON.stringify(raw).length) await writeCurrentSnapshot(compact)
  applySnapshot(await hydrateAssets(withDisplayableCloudBytes(compact, linked)))
  savedRevision = revision
}

function finishLoad(error?: unknown) {
  if (error === undefined) {
    usePersistenceStore.setState({
      phase: 'ready',
      writable: hasLock,
      lockPhase: hasLock ? 'held' : 'idle',
      error: undefined,
    })
    installSubscriptions()
    return
  }
  usePersistenceStore.setState({
    phase: 'error',
    writable: hasLock,
    lockPhase: hasLock ? 'held' : 'idle',
    error: error instanceof Error ? error.message : '读取项目失败',
  })
}

/** 只读取本地存档，不申请编辑锁。编辑锁由画布路由单独持有。 */
export function initializePersistence(): Promise<void> {
  if (initialization) return initialization
  initialization = enqueue(async () => {
    usePersistenceStore.setState({ phase: 'loading', ownerId: persistenceScope(), error: undefined })
    try {
      editLockChannel()
      await readAndApply(hasLock)
      finishLoad()
    } catch (error) {
      finishLoad(error)
    }
  }).finally(() => { initialization = undefined })
  return initialization
}

/** 通知原标签页先保存并变为只读，再用 steal 取得编辑权，然后重新读取存档。 */
export function reclaimEditAccess(): Promise<void> {
  wantsLock = true
  editLockChannel()
  if (initialization) return initialization
  initialization = enqueue(async () => {
    usePersistenceStore.setState({ phase: 'loading', ownerId: persistenceScope(), error: undefined })
    try {
      if (!hasLock) {
        const granted = await requestEditLock(true)
        if (!granted) throw new Error('无法取得项目编辑权')
      }
      await readAndApply(hasLock)
      usePersistenceStore.setState({
        phase: 'ready',
        writable: hasLock,
        lockPhase: hasLock ? 'held' : 'blocked',
        error: undefined,
      })
      installSubscriptions()
    } catch (error) {
      usePersistenceStore.setState({
        phase: 'error',
        writable: hasLock,
        lockPhase: hasLock ? 'held' : 'blocked',
        error: error instanceof Error ? error.message : '读取项目失败',
      })
    }
  }).finally(() => { initialization = undefined })
  return initialization
}

function applySnapshot(snapshot: ProjectSnapshot) {
  suppressChanges = true
  useTaskStore.setState({ tasks: {} })
  useEditorStore.getState().loadProject(snapshot.project)
  const history = restoreHistoryCommands(snapshot.history, snapshot.project.assets)
  useEditorStore.getState().restoreHistory(history.undo, history.redo)
  usePersistenceStore.setState((state) => ({
    cloud: snapshot.cloud,
    drafts: restoreTaskDrafts(snapshot),
    recoveries: snapshot.recoveries,
    epoch: state.epoch + 1,
    status: 'saved',
    error: undefined,
  }))
  suppressChanges = false
}

export function hasUnfinishedGeneration() {
  const { project } = useEditorStore.getState()
  const unresolved = Object.values(usePersistenceStore.getState().recoveries).some((record) => !record.abandoned && !record.applied && !record.backendTaskId)
  return unresolved || Object.values(project?.generations ?? {}).some((job) => ['pending', 'queued', 'processing'].includes(job.status) && !recoveryForTask(job.backendTaskId ?? '')?.abandoned)
}

export async function replaceSnapshot(snapshot: ProjectSnapshot, options?: { signal?: AbortSignal; expectedScope?: string }) {
  const scopeIsCurrent = () => {
    const scope = options?.expectedScope, projectOwner = usePersistenceStore.getState().ownerId
    return scope === undefined || (persistenceScope() === scope && (projectOwner === undefined || projectOwner === scope)
      && (!authEnabled || useUserStore.getState().userId === scope))
  }
  const assertScope = () => { if (!scopeIsCurrent()) throw new Error('账号已切换，已取消项目打开') }
  const assertActive = () => { assertScope(); options?.signal?.throwIfAborted() }
  assertActive()
  if (!usePersistenceStore.getState().writable) throw new Error('当前页面没有项目编辑权')
  if (hasUnfinishedGeneration()) throw new Error('请先处理未完成的任务')
  const valid = parseSnapshot(snapshot)
  if (useEditorStore.getState().project && usePersistenceStore.getState().phase === 'ready') await flushProject()
  assertActive()
  const previousPhase = usePersistenceStore.getState().phase
  // 替换期间卸载业务入口，并与自动保存共用同一条写入队列。
  usePersistenceStore.setState({ phase: 'loading' })
  clearTimeout(timer)
  const operation = queue.catch(() => undefined).then(async () => {
    assertActive()
    const compact = persistableSnapshot(valid)
    await writeCurrentSnapshot(compact, options?.signal)
    // 事务提交后立即应用；换账号时仅保留原账号存档，不写入新账号的编辑器。
    assertScope()
    applySnapshot(parseSnapshot(compact))
    revision += 1
    savedRevision = revision
    usePersistenceStore.setState({ phase: 'ready' })
  }).catch((error: unknown) => {
    if (scopeIsCurrent())
      usePersistenceStore.setState({ phase: previousPhase, status: options?.signal?.aborted ? 'saved' : 'error', error: options?.signal?.aborted ? undefined : error instanceof Error ? error.message : '替换项目失败' })
    throw error
  })
  queue = operation
  await operation
}

export async function newProject() {
  const createdAt = new Date().toISOString()
  const sceneId = crypto.randomUUID()
  await replaceSnapshot({
    schemaVersion: 1,
    project: {
      id: crypto.randomUUID(), name: '未命名画布', createdAt, updatedAt: createdAt,
      document: { version: 1, activeSceneId: sceneId, scenes: [{ id: sceneId, name: '场景 1', width: 1280, height: 720, nodes: [], viewport: { zoom: 1, panX: 0, panY: 0 } }] },
      assets: {}, generations: {},
    },
    drafts: defaultDrafts(), recoveries: {},
  })
}

export async function restartAfterLoadError() {
  if (!hasLock) throw new Error('请先取得项目编辑权')
  // 原始损坏数据由错误页面提供下载；只有用户确认后才替换。
  usePersistenceStore.setState({ recoveries: {} })
  useEditorStore.setState({ project: null })
  await newProject()
  usePersistenceStore.setState({ phase: 'ready', raw: undefined })
  installSubscriptions()
}

export function downloadJson(value: unknown, filename: string) {
  const content = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
  const link = document.createElement('a')
  link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function exportProject() {
  const snapshot = currentSnapshot()
  downloadJson(serializeSnapshot(snapshot), `${snapshot.project.name.replace(/[\\/:*?"<>|]/g, '_')}.pixel.json`)
}

/** 签名地址属于运行时缓存，更新时不生成本地或云端编辑版本。 */
export function updateRuntimeAssetAccess(items: { id: string; url: string; expiresAt: number }[]) {
  const previous = suppressChanges
  suppressChanges = true
  try {
    useEditorStore.setState(state => {
      if (!state.project) return state
      const assets = { ...state.project.assets }
      for (const item of items) if (assets[item.id]) assets[item.id] = { ...assets[item.id], url: item.url, accessExpiresAt: item.expiresAt, missing: false }
      return { project: { ...state.project, assets } }
    })
  } finally { suppressChanges = previous }
}
