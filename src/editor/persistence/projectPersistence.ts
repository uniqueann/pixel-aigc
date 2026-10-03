import { hydrateAssets } from '@/cloud/assets'
import { useEditorStore } from '@/editor/store'
import { useTaskStore } from '@/store/useTaskStore'
import { useUserStore } from '@/store/useUserStore'
import { readCurrentSnapshot, writeCurrentSnapshot, persistenceScope } from './database'
import { linkOwnedAssetKeys } from './ownedAssetKeys'
import { restoreTaskDrafts } from './restoreDrafts'
import { parseSnapshot, serializeSnapshot, persistableSnapshot, restoreHistoryCommands } from './snapshot'
import { recoveryForTask, usePersistenceStore } from './persistenceStore'
import { defaultDrafts, type ProjectSnapshot } from './types'

let initialization: Promise<void> | undefined
let subscribed = false
let revision = 0
let savedRevision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let queue: Promise<unknown> = Promise.resolve()
let releaseLock: (() => void) | undefined
let hasLock = false
let suppressChanges = false

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
  if (suppressChanges || usePersistenceStore.getState().phase !== 'ready') return
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
    if (!state.writable || state.phase !== 'ready') throw new Error('当前页面没有项目编辑权')
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
  window.addEventListener('pagehide', () => { releaseLock?.(); hasLock = false })
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

async function acquireLock() {
  if (hasLock) return true
  if (!navigator.locks) throw new Error('此浏览器不支持安全的本地项目编辑锁，请使用新版浏览器')
  return new Promise<boolean>((resolve, reject) => {
    void navigator.locks.request(`pixel-aigc-current-project:${persistenceScope()}`, { ifAvailable: true }, async (lock) => {
      if (!lock) { resolve(false); return }
      hasLock = true
      resolve(true)
      await new Promise<void>((release) => { releaseLock = release })
    }).catch(reject)
  })
}

export function initializePersistence(): Promise<void> {
  if (initialization) return initialization
  initialization = (async () => {
    usePersistenceStore.setState({ phase: 'loading', error: undefined })
    try {
      const writable = await acquireLock()
      usePersistenceStore.setState({ writable })
      const raw = await readCurrentSnapshot()
      usePersistenceStore.setState({ raw, writable })
      if (raw !== undefined) {
        const parsed = parseSnapshot(raw)
        const linked = await linkOwnedAssetKeys(parsed)
        const compact = persistableSnapshot(linked)
        if (JSON.stringify(compact).length < JSON.stringify(raw).length) await writeCurrentSnapshot(compact)
        applySnapshot(await hydrateAssets(withDisplayableCloudBytes(compact, linked)))
        savedRevision = revision
      }
      usePersistenceStore.setState({ phase: 'ready' })
      installSubscriptions()
    } catch (error) {
      usePersistenceStore.setState({
        phase: 'error',
        writable: hasLock,
        error: error instanceof Error ? error.message : '读取项目失败',
      })
    }
  })().finally(() => { initialization = undefined })
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

export async function replaceSnapshot(snapshot: ProjectSnapshot) {
  if (!usePersistenceStore.getState().writable) throw new Error('当前页面没有项目编辑权')
  if (hasUnfinishedGeneration()) throw new Error('请先处理未完成的任务')
  const valid = parseSnapshot(snapshot)
  if (useEditorStore.getState().project && usePersistenceStore.getState().phase === 'ready') await flushProject()
  const previousPhase = usePersistenceStore.getState().phase
  // 替换期间卸载业务入口，并与自动保存共用同一条写入队列。
  usePersistenceStore.setState({ phase: 'loading' })
  clearTimeout(timer)
  const operation = queue.catch(() => undefined).then(async () => {
    const compact = persistableSnapshot(valid)
    await writeCurrentSnapshot(compact)
    applySnapshot(parseSnapshot(compact))
    revision += 1
    savedRevision = revision
    usePersistenceStore.setState({ phase: 'ready' })
  }).catch((error: unknown) => {
    usePersistenceStore.setState({ phase: previousPhase, status: 'error', error: error instanceof Error ? error.message : '替换项目失败' })
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
