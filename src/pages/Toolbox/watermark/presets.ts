import { i18n } from '@/i18n'
import { migrateWatermarkSettings, type WatermarkSettings } from './types'

const DATABASE_NAME = 'pixel-aigc-watermark-presets'
const STORE_NAME = 'presets'

export interface WatermarkPreset {
  id: string
  scope: string
  name: string
  settings: WatermarkSettings
  updatedAt: number
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error(i18n.t('toolbox:presets.openDbFailed')))
  })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: Error) => void) => void) {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    let result: T
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error(i18n.t('toolbox:presets.txFailed'))) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error(i18n.t('toolbox:presets.txAborted'))) }
    action(transaction.objectStore(STORE_NAME), value => { result = value }, reject)
  })
}

export async function listPresets(scope: string): Promise<WatermarkPreset[]> {
  const records = await transact<WatermarkPreset[]>('readonly', (store, resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(request.result as WatermarkPreset[])
    request.onerror = () => reject(request.error ?? new Error(i18n.t('toolbox:presets.listFailed')))
  })
  return records.filter(record => record.scope === scope)
    .map(record => ({ ...record, settings: migrateWatermarkSettings(record.settings) }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function savePreset(scope: string, name: string, settings: WatermarkSettings): Promise<WatermarkPreset> {
  const preset: WatermarkPreset = { id: crypto.randomUUID(), scope, name, settings, updatedAt: Date.now() }
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(preset)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(i18n.t('toolbox:presets.saveFailed')))
  })
  return preset
}

export async function deletePreset(id: string): Promise<void> {
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.delete(id)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error(i18n.t('toolbox:presets.removeFailed')))
  })
}
