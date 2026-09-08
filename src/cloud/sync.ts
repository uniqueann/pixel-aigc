import { create } from 'zustand'
import { projectWriteSchema, type CloudProject, type ProjectWrite } from '../../shared/cloud'
import { cloudEnabled, CloudError, cloudRequest } from './client'
import { accessAssets, assetPlaceholder, hydrateAssets, uploadCloudImage } from './assets'
import { useEditorStore } from '@/editor/store'
import { usePersistenceStore } from '@/editor/persistence/persistenceStore'
import { currentSnapshot, flushProject, hasUnfinishedGeneration, replaceSnapshot, updateRuntimeAssetAccess } from '@/editor/persistence/projectPersistence'
import { persistableSnapshot } from '@/editor/persistence/snapshot'
import { saveConflictSnapshot } from '@/editor/persistence/database'
import type { ProjectSnapshot } from '@/editor/persistence/types'

export const useCloudStore = create<{ busy: boolean; interacting: boolean; error?: string; status: string }>(() => ({ interacting: false, busy: false, status: '尚未同步' }))
let running: Promise<void> | undefined
let timer: ReturnType<typeof setTimeout> | undefined
function inputOf(snapshot: ProjectSnapshot): ProjectWrite {
  return projectWriteSchema.parse({ name: snapshot.project.name.trim() || '未命名画布', document: snapshot.project.document, drafts: snapshot.drafts, schemaVersion: 1 })
}
const fingerprint = (snapshot: ProjectSnapshot) => JSON.stringify(inputOf(snapshot))
export async function openCloudProject(id: string) {
  if (useCloudStore.getState().busy) throw new Error('请等待当前同步完成')
  useCloudStore.setState({ busy: true })
  try {
  await flushProject()
  const before = JSON.stringify(persistableSnapshot(currentSnapshot()))
  const remote = await cloudRequest<CloudProject>(`/projects/${encodeURIComponent(id)}`)
  if (JSON.stringify(persistableSnapshot(currentSnapshot())) !== before) throw new Error('读取期间本地内容发生变化，请先保存后重新打开')
  const snapshot: ProjectSnapshot = {
    schemaVersion: 1, cloud: { revision: remote.revision, pending: false }, drafts: remote.drafts, recoveries: {},
    project: { id: remote.id, name: remote.name, document: remote.document, createdAt: remote.createdAt, updatedAt: remote.updatedAt, generations: {},
      assets: Object.fromEntries(remote.assets.map(asset => [asset.id, { ...asset, url: assetPlaceholder(asset.id), storage: { provider: 'r2' as const, objectKey: asset.objectKey, projectId: id } }])) },
  }
  const hydrated = await hydrateAssets(snapshot)
  if (JSON.stringify(persistableSnapshot(currentSnapshot())) !== before) throw new Error('读取期间本地内容发生变化，请先保存后重新打开')
  await replaceSnapshot(hydrated)
  useCloudStore.setState({ error: undefined, status: '云端已保存' })
  } finally { useCloudStore.setState({ busy: false }) }
}
async function createRemote(snapshot: ProjectSnapshot) {
  const input = inputOf(snapshot)
  const remote = await cloudRequest<CloudProject>('/projects', 'POST', { ...input, id: snapshot.project.id,
    document: { ...input.document, scenes: input.document.scenes.map(scene => ({ ...scene, nodes: scene.nodes.filter(n => n.type === 'text' || n.type === 'shape') })) },
    drafts: { ...input.drafts, derived: undefined },
  })
  return remote.revision
}
async function syncOnce() {
  if (!cloudEnabled || !useEditorStore.getState().project) return
  if (usePersistenceStore.getState().cloud?.conflict) throw new Error('请先处理云端版本冲突')
  if (hasUnfinishedGeneration()) throw new Error('请先处理本地未完成任务')
  const snapshot = currentSnapshot(), id = snapshot.project.id
  let revision = snapshot.cloud?.revision
  if (!revision) {
    revision = await createRemote(snapshot)
    usePersistenceStore.setState({ cloud: { revision, pending: true } })
    await flushProject()
  }
  // 按素材 ID 重试，上传完成后立即落本地盘；中断迁移不会重复创建素材。
  const referenced = new Set(snapshot.project.document.scenes.flatMap(scene => scene.nodes.flatMap(node => 'assetId' in node ? [node.assetId] : [])))
  if (snapshot.drafts.derived) referenced.add(snapshot.drafts.derived.sourceAssetId)
  for (const asset of Object.values(snapshot.project.assets)) {
    if (!referenced.has(asset.id)) continue
    if (asset.storage?.projectId === id) continue
    if (asset.type !== 'image') throw new Error(`「${asset.name}」暂不支持云端迁移，请保留本地备份`)
    try {
      const sourceUrl = asset.storage ? (await accessAssets(asset.storage.projectId, [asset.id]))[0].url : asset.url
      const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(30000) })
      if (!response.ok) throw new Error('读取失败')
      const blob = await response.blob()
      const file = new File([blob], asset.name, { type: blob.type || asset.mimeType })
      const uploaded = await uploadCloudImage(id, asset.id, file)
      const [access] = await accessAssets(id, [asset.id])
      const updated = { ...asset, ...uploaded, url: access.url, accessExpiresAt: access.expiresAt, missing: false,
        generationId: undefined, source: 'upload' as const, storage: { provider: 'r2' as const, objectKey: uploaded.objectKey, projectId: id } }
      if (useEditorStore.getState().project?.id !== id) throw new Error('项目已切换')
      useEditorStore.getState().registerAsset(updated)
      await flushProject()
    } catch (error) {
      const live = useEditorStore.getState().project?.assets[asset.id]
      if (live && !live.storage) useEditorStore.getState().registerAsset({ ...live, missing: true })
      const failure = new Error(`「${asset.name}」上传失败，可重试或重新选择文件：${error instanceof Error ? error.message : '素材不可用'}`)
      Object.defineProperty(failure, 'cause', { value: error })
      throw failure
    }
  }
  // 模拟任务历史仅留在本地备份；已生成图片作为普通素材上传。
  const current = currentSnapshot()
  const input = inputOf(current)
  if (input.document.scenes.some(scene => scene.nodes.some(node => node.type === 'generation')))
    throw new Error('请先移除本地模拟任务占位，再同步项目')
  const sentFingerprint = fingerprint(current)
  try {
    const response = await cloudRequest<{ revision: number }>(`/projects/${encodeURIComponent(id)}`, 'PUT', { ...input, baseRevision: revision })
    usePersistenceStore.setState({ cloud: { revision: response.revision, pending: fingerprint(currentSnapshot()) !== sentFingerprint } })
    useCloudStore.setState({ error: undefined, status: '云端已保存' })
    await flushProject()
  } catch (error) {
    if (error instanceof CloudError && error.status === 409) {
      await saveConflictSnapshot(persistableSnapshot(currentSnapshot()))
      usePersistenceStore.setState({ cloud: { revision, pending: true, conflict: true } })
      await flushProject()
      useCloudStore.setState({ status: '版本冲突' })
    }
    throw error
  }
}
export function syncProject(): Promise<void> {
  if (running) return running
  if (useCloudStore.getState().busy) return Promise.reject(new Error('请等待项目读取完成'))
  clearTimeout(timer)
  useCloudStore.setState({ busy: true, status: '云端同步中…', error: undefined })
  running = syncOnce().catch(error => {
    useCloudStore.setState({ error: error instanceof Error ? error.message : '云端同步失败', status: usePersistenceStore.getState().cloud?.conflict ? '版本冲突' : '云端未保存' })
    throw error
  }).finally(() => { running = undefined; useCloudStore.setState({ busy: false }) })
  return running
}
export async function forkLocalProject() {
  if (useCloudStore.getState().busy) throw new Error('请等待同步完成')
  const original = currentSnapshot()
  await saveConflictSnapshot(persistableSnapshot(original))
  const copy = await hydrateAssets(original)
  copy.project.id = crypto.randomUUID()
  copy.project.name = `${copy.project.name.slice(0,80)}（副本）`
  copy.cloud = undefined
  // 源项目私有素材通过当前用户的短期地址复制到新项目，不跨项目共享对象。
  copy.recoveries = {}
  await replaceSnapshot(copy)
  await syncProject()
}
export async function refreshAssetAccess() {
  const project = useEditorStore.getState().project
  if (!project || useCloudStore.getState().busy) return
  const ids = Object.values(project.assets).filter(a => a.storage && (!a.accessExpiresAt || a.accessExpiresAt - Date.now() < 180000)).map(a => a.id)
  if (!ids.length) return
  const access = await accessAssets(project.id, ids)
  if (useEditorStore.getState().project?.id !== project.id) return
  updateRuntimeAssetAccess(access)
}
let booted = false
export function startCloudSync() {
  const schedule = () => {
    clearTimeout(timer)
    if (useCloudStore.getState().interacting) return
    if (!usePersistenceStore.getState().cloud?.pending || usePersistenceStore.getState().cloud?.conflict) return
    timer = setTimeout(() => { void syncProject().catch(() => undefined) }, 2000)
  }
  const unsubscribeEditor = useEditorStore.subscribe(schedule)
  const unsubscribePersistence = usePersistenceStore.subscribe((state, previous) => {
    if (state.drafts !== previous.drafts || state.cloud !== previous.cloud) schedule()
  })
  const online = () => { schedule(); void refreshAssetAccess().catch(() => undefined) }
  window.addEventListener('online', online)
  const interval = setInterval(() => {
    if (usePersistenceStore.getState().cloud?.pending) schedule()
    void refreshAssetAccess().catch(() => undefined)
  }, 60000)
  if (!booted) {
    booted = true
    const state = usePersistenceStore.getState()
    const id = useEditorStore.getState().project?.id
    if (id && state.cloud && !state.cloud.pending) void openCloudProject(id).catch(error => useCloudStore.setState({ error: String(error.message) }))
    else schedule()
  }
  return () => { unsubscribeEditor(); unsubscribePersistence(); clearInterval(interval); clearTimeout(timer); window.removeEventListener('online', online) }
}
