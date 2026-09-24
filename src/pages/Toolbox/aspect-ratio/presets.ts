import { normalizeSettings } from './prefs'
import type { AspectRatioSettings } from './types'

const DATABASE_NAME = 'pixel-aigc-aspect-ratio-presets'
const STORE_NAME = 'presets'

export interface AspectRatioPreset {
  id: string
  scope: string
  name: string
  settings: AspectRatioSettings
  updatedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开本地模板库'))
  })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: Error) => void) => void) {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    let result: T
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('本地模板操作失败')) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('本地模板操作已中止')) }
    action(transaction.objectStore(STORE_NAME), value => { result = value }, reject)
  })
}

export async function listPresets(scope: string): Promise<AspectRatioPreset[]> {
  const records = await transact<AspectRatioPreset[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as AspectRatioPreset[])
    request.onerror = () => reject(request.error ?? new Error('读取模板失败'))
  })
  return records.filter(record => record.scope === scope)
    .map(record => ({ ...record, settings: normalizeSettings(record.settings) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function savePreset(scope: string, name: string, settings: AspectRatioSettings): Promise<AspectRatioPreset> {
  const preset: AspectRatioPreset = {
    id: crypto.randomUUID(),
    scope,
    name,
    settings: normalizeSettings(settings),
    updatedAt: Date.now(),
  }
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(preset)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('保存模板失败'))
  })
  return preset
}

export async function deletePreset(id: string): Promise<void> {
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('删除模板失败'))
  })
}
