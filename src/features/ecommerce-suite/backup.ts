import type { SuiteActor, SuiteQuote } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'

interface Backup { detail: SuiteProjectDetail; savedAt: number; complete: boolean; conflictConfig?: SuiteProjectDetail['project']['config'] }
export interface PendingSuiteSubmission { projectId: string; requestId: string; quote: SuiteQuote; createdAt: number }
const key = (actor: SuiteActor, id: string) => JSON.stringify([actor.userId, actor.runtimeScope, id])
const backupWrites = new Map<string, Promise<void>>()
async function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('pixel-ecommerce-suite-v1', 1)
    request.onupgradeneeded = () => { for (const name of ['projects', 'images', 'pending', 'creation']) request.result.createObjectStore(name) }
    request.onerror = () => reject(request.error ?? new Error('本地备份不可用'))
    let blocked = false
    request.onblocked = () => { blocked = true; reject(new Error('本地备份正在升级，请关闭其他页面后重试')) }
    request.onsuccess = () => { if (blocked) { request.result.close(); return }; request.result.onversionchange = () => request.result.close(); resolve(request.result) }
  })
}
async function read<T>(store: string, recordKey: string): Promise<T | undefined> {
  const db = await open()
  try { return await new Promise<T | undefined>((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(recordKey)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error)
  }) } finally { db.close() }
}
async function write(store: string, recordKey: string, value: unknown) {
  const db = await open()
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    if (value === undefined) tx.objectStore(store).delete(recordKey)
    else tx.objectStore(store).put(value, recordKey)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('本地存储空间不足'))
  }) } finally { db.close() }
}
export const readSuiteBackup = (actor: SuiteActor, id: string) => read<Backup>('projects', key(actor, id))
export const readSuiteBlob = (actor: SuiteActor, projectId: string, assetId: string) => read<Blob>('images', key(actor, `${projectId}:${assetId}`))
export const saveSuiteBlob = (actor: SuiteActor, projectId: string, assetId: string, blob: Blob) => write('images', key(actor, `${projectId}:${assetId}`), blob)
export function saveSuiteBackup(actor: SuiteActor, detail: SuiteProjectDetail, complete = false, conflictConfig?: Backup['conflictConfig'] | null) {
  const recordKey = key(actor, detail.project.id)
  const snapshot = structuredClone(detail)
  const action = (backupWrites.get(recordKey) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const old = await readSuiteBackup(actor, snapshot.project.id)
    const versions = [...new Map([...(old?.detail.versions ?? []), ...snapshot.versions].map(version => [version.id, version])).values()]
    const merged = { ...snapshot, versions }
    const covered = old?.complete && merged.assets.every(asset => old.detail.assets.some(previous => previous.assetId === asset.assetId && previous.checksum === asset.checksum))
    await write('projects', recordKey, { detail: merged, savedAt: Date.now(), complete: complete || Boolean(covered),
      conflictConfig: conflictConfig === null ? undefined : conflictConfig ?? old?.conflictConfig } satisfies Backup)
  })
  backupWrites.set(recordKey, action)
  void action.finally(() => { if (backupWrites.get(recordKey) === action) backupWrites.delete(recordKey) }).catch(() => undefined)
  return action
}
export const readPendingSuite = (actor: SuiteActor, id: string) => read<PendingSuiteSubmission>('pending', key(actor, id))
export const savePendingSuite = (actor: SuiteActor, pending: PendingSuiteSubmission) => write('pending', key(actor, pending.projectId), pending)
export const clearPendingSuite = (actor: SuiteActor, id: string) => write('pending', key(actor, id), undefined)
export interface SuiteCreationDraft { requestId: string; config: SuiteProjectDetail['project']['config']; image: Blob }
export const readSuiteCreation = (actor: SuiteActor) => read<SuiteCreationDraft>('creation', key(actor, 'creation'))
export const saveSuiteCreation = (actor: SuiteActor, value: SuiteCreationDraft | undefined) => write('creation', key(actor, 'creation'), value)
export interface LocalSuiteDraft { value: import('@shared/ecommerce-suite').SuiteSlotDraft; dirty: boolean }
export const readLocalSuiteDraft = (actor: SuiteActor, projectId: string, slotId: string) => read<LocalSuiteDraft>('projects', key(actor, `slot-draft:${projectId}:${slotId}`))
const localDraftWrites = new Map<string, Promise<void>>()
export function saveLocalSuiteDraft(actor: SuiteActor, projectId: string, slotId: string, value: LocalSuiteDraft) {
  const recordKey = key(actor, `slot-draft:${projectId}:${slotId}`), snapshot = structuredClone(value)
  const action = (localDraftWrites.get(recordKey) ?? Promise.resolve()).catch(() => undefined).then(() => write('projects', recordKey, snapshot))
  localDraftWrites.set(recordKey, action)
  void action.finally(() => { if (localDraftWrites.get(recordKey) === action) localDraftWrites.delete(recordKey) }).catch(() => undefined)
  return action
}
export const archiveSuiteDraft = (actor: SuiteActor, projectId: string, slotId: string, value: LocalSuiteDraft) => write('projects', key(actor, `archived-draft:${projectId}:${slotId}:${Date.now()}:${crypto.randomUUID()}`), { ...structuredClone(value), slotId, savedAt: Date.now() })
export async function listArchivedSuiteDrafts(actor: SuiteActor, projectId: string, slotId?: string) {
  const db = await open()
  try { return await new Promise<(LocalSuiteDraft & { slotId: string; savedAt: number })[]>((resolve,reject) => {
    const result: (LocalSuiteDraft & { slotId: string; savedAt: number })[] = []
    const tx = db.transaction('projects'), cursor = tx.objectStore('projects').openCursor()
    cursor.onsuccess = () => {
      const item = cursor.result
      if (!item) return
      try {
        const identity = JSON.parse(String(item.key))
        if (identity[0] === actor.userId && identity[1] === actor.runtimeScope && String(identity[2]).startsWith(`archived-draft:${projectId}:${slotId ? `${slotId}:` : ''}`)) result.push(item.value)
      } catch { /* 忽略不属于当前账号环境的旧缓存键。 */ }
      item.continue()
    }
    tx.oncomplete = () => resolve(result.sort((a,b) => b.savedAt-a.savedAt)); tx.onerror = () => reject(tx.error)
  }) } finally { db.close() }
}
