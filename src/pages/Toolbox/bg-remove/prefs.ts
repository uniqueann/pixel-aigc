import { DEFAULT_BG_REMOVE_SETTINGS, type BgRemoveSettings } from './types'

const DATABASE_NAME = 'pixel-aigc-bg-remove-prefs'
const STORE_NAME = 'prefs'

interface StoredPrefs {
  scope: string
  settings: BgRemoveSettings
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

export async function readPrefs(scope: string): Promise<BgRemoveSettings> {
  const record = await transact<StoredPrefs | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(scope)
    request.onsuccess = () => resolve(request.result as StoredPrefs | undefined)
    request.onerror = () => reject(request.error ?? new Error('读取抠图设置失败'))
  })
  return normalizeSettings(record?.settings)
}

export async function writePrefs(scope: string, settings: BgRemoveSettings): Promise<void> {
  const record: StoredPrefs = { scope, settings: normalizeSettings(settings) }
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('保存抠图设置失败'))
  })
}
