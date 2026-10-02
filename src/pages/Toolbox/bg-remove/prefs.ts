import { DEFAULT_BG_REMOVE_SETTINGS, type BgRemoveSettings } from './types'

const DATABASE_NAME = 'pixel-aigc-bg-remove-prefs'
const STORE_NAME = 'prefs'

export interface BgRemoveQueueSnapshot {
  id: string
  name: string
  width: number
  height: number
  objectKey?: string
  createdAt: string
}

interface StoredPrefs {
  scope: string
  settings: BgRemoveSettings
  queue?: BgRemoveQueueSnapshot[]
  selectedId?: string | null
}

export function normalizeSettings(value: Partial<BgRemoveSettings> | null | undefined): BgRemoveSettings {
  const background = value?.background
  if (background === 'transparent' || (typeof background === 'string' && /^#[0-9a-fA-F]{6}$/.test(background))) {
    return { background }
  }
  return DEFAULT_BG_REMOVE_SETTINGS
}

export function outputMime(background: string) {
  return background === 'transparent' ? 'image/png' : 'image/jpeg'
}

export function normalizeQueue(value: unknown): BgRemoveQueueSnapshot[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return []
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim()) return []
    if (typeof record.name !== 'string' || !record.name.trim()) return []
    if (typeof record.width !== 'number' || !Number.isFinite(record.width) || record.width <= 0) return []
    if (typeof record.height !== 'number' || !Number.isFinite(record.height) || record.height <= 0) return []
    return [{
      id: record.id,
      name: record.name,
      width: record.width,
      height: record.height,
      objectKey: typeof record.objectKey === 'string' && record.objectKey.trim() ? record.objectKey : undefined,
      createdAt: typeof record.createdAt === 'string' && record.createdAt ? record.createdAt : new Date().toISOString(),
    }]
  })
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'scope' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开抠图设置'))
  })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: Error) => void) => void) {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    let result: T
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('读取抠图设置失败')) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('抠图设置操作已中止')) }
    action(transaction.objectStore(STORE_NAME), value => { result = value }, reject)
  })
}

async function readRecord(scope: string): Promise<StoredPrefs | undefined> {
  return transact<StoredPrefs | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(scope)
    request.onsuccess = () => resolve(request.result as StoredPrefs | undefined)
    request.onerror = () => reject(request.error ?? new Error('读取抠图设置失败'))
  })
}

async function mergeRecord(scope: string, patch: Partial<Omit<StoredPrefs, 'scope'>>) {
  const existing = await readRecord(scope)
  const record: StoredPrefs = {
    scope,
    settings: patch.settings ?? existing?.settings ?? DEFAULT_BG_REMOVE_SETTINGS,
    queue: 'queue' in patch ? patch.queue : existing?.queue,
    selectedId: 'selectedId' in patch ? patch.selectedId : existing?.selectedId,
  }
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('保存抠图设置失败'))
  })
}

export async function readPrefs(scope: string): Promise<BgRemoveSettings> {
  return normalizeSettings((await readRecord(scope))?.settings)
}

export async function writePrefs(scope: string, settings: BgRemoveSettings): Promise<void> {
  await mergeRecord(scope, { settings: normalizeSettings(settings) })
}

export async function clearPrefs(scope: string): Promise<void> {
  await mergeRecord(scope, { settings: DEFAULT_BG_REMOVE_SETTINGS })
}

export async function readQueue(scope: string): Promise<{ queue?: BgRemoveQueueSnapshot[]; selectedId: string | null }> {
  const record = await readRecord(scope)
  return {
    queue: normalizeQueue(record?.queue),
    selectedId: typeof record?.selectedId === 'string' ? record.selectedId : record?.selectedId === null ? null : null,
  }
}

export async function writeQueue(scope: string, queue: BgRemoveQueueSnapshot[], selectedId: string | null): Promise<void> {
  await mergeRecord(scope, { queue: normalizeQueue(queue) ?? [], selectedId })
}
