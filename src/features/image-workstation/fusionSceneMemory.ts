import type { ImageAsset } from '@/editor/types'

/** 只记住最近一次用过的场景图；元数据与图片分表，空槽位提示无需读取整张图。 */
const DATABASE_NAME = 'pixel-aigc-fusion-scene'
const META = 'sceneMeta'
const FILES = 'sceneFiles'

export interface FusionSceneMeta {
  name: string
  width: number
  height: number
  mimeType: string
  savedAt: string
}
export interface FusionScene extends FusionSceneMeta { blob: Blob }
interface StoredMeta extends FusionSceneMeta { ownerId: string }
interface StoredFile { ownerId: string; blob: Blob }

function available() { return typeof indexedDB !== 'undefined' }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'ownerId' })
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES, { keyPath: 'ownerId' })
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开上次场景'))
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}

function transaction<T>(names: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction, done: (value: T) => void) => void): Promise<T> {
  return openDatabase().then(db => new Promise<T>((resolve, reject) => {
    const tx = db.transaction(names, mode)
    let value: T
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = tx.onerror = () => { db.close(); reject(tx.error ?? new Error('上次场景操作失败')) }
    try { operation(tx, result => { value = result }) } catch (error) { tx.abort(); db.close(); reject(error) }
  }))
}

/** 保存场景图；调用方应吞掉失败，记住场景不能影响主流程。 */
export async function rememberFusionScene(ownerId: string, scene: { blob: Blob } & Omit<FusionSceneMeta, 'savedAt'>): Promise<void> {
  if (!available() || !ownerId.trim() || !scene.blob.size) return
  const meta: FusionSceneMeta = {
    name: scene.name,
    width: scene.width,
    height: scene.height,
    mimeType: scene.mimeType,
    savedAt: new Date().toISOString(),
  }
  await transaction([META, FILES], 'readwrite', tx => {
    tx.objectStore(META).put({ ownerId, ...meta } satisfies StoredMeta)
    tx.objectStore(FILES).put({ ownerId, blob: scene.blob } satisfies StoredFile)
  })
}

export async function readFusionSceneMeta(ownerId: string): Promise<FusionSceneMeta | undefined> {
  if (!available() || !ownerId.trim()) return undefined
  return transaction<FusionSceneMeta | undefined>([META], 'readonly', (tx, done) => {
    const request = tx.objectStore(META).get(ownerId)
    request.onsuccess = () => {
      const stored = request.result as StoredMeta | undefined
      if (!stored) { done(undefined); return }
      const { ownerId: _ownerId, ...meta } = stored
      void _ownerId
      done(meta)
    }
  })
}

export async function readFusionScene(ownerId: string): Promise<FusionScene | undefined> {
  if (!available() || !ownerId.trim()) return undefined
  const meta = await readFusionSceneMeta(ownerId)
  if (!meta) return undefined
  const file = await transaction<StoredFile | undefined>([FILES], 'readonly', (tx, done) => {
    const request = tx.objectStore(FILES).get(ownerId)
    request.onsuccess = () => done(request.result)
  })
  return file?.blob?.size ? { ...meta, blob: file.blob } : undefined
}

export async function forgetFusionScene(ownerId: string): Promise<void> {
  if (!available() || !ownerId.trim()) return
  await transaction([META, FILES], 'readwrite', tx => {
    tx.objectStore(META).delete(ownerId)
    tx.objectStore(FILES).delete(ownerId)
  })
}

/** 把记住的场景还原成可直接放进场景槽位的资产。 */
export function fusionSceneAsset(scene: FusionScene): ImageAsset {
  return {
    id: crypto.randomUUID(),
    type: 'image',
    name: scene.name,
    url: URL.createObjectURL(scene.blob),
    mimeType: scene.mimeType,
    width: scene.width,
    height: scene.height,
    source: 'upload',
    createdAt: new Date().toISOString(),
  }
}
