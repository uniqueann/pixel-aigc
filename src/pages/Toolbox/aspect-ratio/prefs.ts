import { PLATFORM_SIZE_PRESETS } from '@/constants/platformSizes'
import { DEFAULT_ASPECT_RATIO_SETTINGS, type AspectRatioSettings, type FitStrategy } from './types'

const DATABASE_NAME = 'pixel-aigc-aspect-ratio-prefs'
const STORE_NAME = 'prefs'

interface StoredPrefs {
  scope: string
  settings: AspectRatioSettings
}

const strategies = new Set<FitStrategy>(['letterbox', 'crop', 'outpaint'])

export function normalizeSettings(value: Partial<AspectRatioSettings> | null | undefined): AspectRatioSettings {
  const requestedPresetId = value?.selectedPresetId
  const presetId = requestedPresetId && PLATFORM_SIZE_PRESETS.some(preset => preset.id === requestedPresetId)
    ? requestedPresetId
    : DEFAULT_ASPECT_RATIO_SETTINGS.selectedPresetId
  const strategy = value?.strategy && strategies.has(value.strategy) && value.strategy !== 'outpaint'
    ? value.strategy
    : DEFAULT_ASPECT_RATIO_SETTINGS.strategy
  const fx = typeof value?.fx === 'number' && Number.isFinite(value.fx) ? Math.min(1, Math.max(0, value.fx)) : 0.5
  const fy = typeof value?.fy === 'number' && Number.isFinite(value.fy) ? Math.min(1, Math.max(0, value.fy)) : 0.5
  const rawBackground = value?.background
  const background = rawBackground === 'transparent' || (typeof rawBackground === 'string' && /^#[0-9a-fA-F]{6}$/.test(rawBackground))
    ? rawBackground
    : DEFAULT_ASPECT_RATIO_SETTINGS.background
  if (typeof background !== 'string') return DEFAULT_ASPECT_RATIO_SETTINGS
  return { strategy, selectedPresetId: presetId, background, fx, fy }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: 'scope' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('无法打开转比例设置'))
  })
}

async function transact<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore, resolve: (value: T) => void, reject: (reason: Error) => void) => void) {
  const db = await openDatabase()
  return new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    let result: T
    transaction.oncomplete = () => { db.close(); resolve(result) }
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('读取转比例设置失败')) }
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('转比例设置操作已中止')) }
    action(transaction.objectStore(STORE_NAME), value => { result = value }, reject)
  })
}

export async function readPrefs(scope: string): Promise<AspectRatioSettings> {
  const record = await transact<StoredPrefs | undefined>('readonly', (store, resolve, reject) => {
    const request = store.get(scope)
    request.onsuccess = () => resolve(request.result as StoredPrefs | undefined)
    request.onerror = () => reject(request.error ?? new Error('读取转比例设置失败'))
  })
  return normalizeSettings(record?.settings)
}

export async function writePrefs(scope: string, settings: AspectRatioSettings): Promise<void> {
  const record: StoredPrefs = { scope, settings: normalizeSettings(settings) }
  await transact<void>('readwrite', (store, resolve, reject) => {
    const request = store.put(record)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error ?? new Error('保存转比例设置失败'))
  })
}
