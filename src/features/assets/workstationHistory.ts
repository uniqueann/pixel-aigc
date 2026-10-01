import { detectImageMime, readBlobBytes } from '@shared/image-format'
import { Capability } from '@/types'

const DATABASE_NAME = 'pixel-aigc-history-v2'
const STORE_NAME = 'workstationResults'
const DATABASE_VERSION = 1
const MAX_ITEMS = 50

export type WorkstationHistorySlug = 'repaint' | 'remove' | 'outpaint' | 'smart-edit' | string

export interface WorkstationHistoryRecord {
  id: string
  toolSlug: WorkstationHistorySlug
  capability: Capability
  prompt?: string
  width: number
  height: number
  mimeType: string
  result: Blob
  createdAt: string
  updatedAt: string
}

interface StoredHistoryRecord extends Omit<WorkstationHistoryRecord, 'result'> {
  ownerId: string
  resultBytes: ArrayBuffer
}

function requireOwner(ownerId: string) {
  if (!ownerId.trim()) throw new Error('缺少历史记录所属账号')
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: ['ownerId', 'id'] })
        store.createIndex('ownerId', 'ownerId')
      }
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地历史'))
    request.onblocked = () => reject(new Error('本地历史正在升级，请关闭其他页面后重试'))
    request.onsuccess = () => resolve(request.result)
  })
}

function runStore<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T> {
  return openHistoryDatabase().then((db) => new Promise<T>((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode)
    const request = operation(transaction.objectStore(STORE_NAME))
    transaction.oncomplete = () => {
      db.close()
      resolve((request ? request.result : undefined) as T)
    }
    transaction.onabort = transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? (request instanceof IDBRequest ? request.error : undefined) ?? new Error('本地历史操作失败'))
    }
  }))
}

function toRecord(stored: StoredHistoryRecord): WorkstationHistoryRecord {
  const { ownerId: _ownerId, resultBytes, ...record } = stored
  void _ownerId
  const mimeType = detectImageMime(new Uint8Array(resultBytes, 0, Math.min(32, resultBytes.byteLength))) ?? stored.mimeType
  return { ...record, mimeType, result: new Blob([resultBytes], { type: mimeType }) }
}

async function toStored(ownerId: string, record: WorkstationHistoryRecord): Promise<StoredHistoryRecord> {
  const { result, ...fields } = record
  const resultBytes = await readBlobBytes(result)
  const mimeType = detectImageMime(new Uint8Array(resultBytes, 0, Math.min(32, resultBytes.byteLength))) ?? fields.mimeType
  return { ...fields, mimeType, ownerId, resultBytes }
}

export async function listWorkstationHistory(ownerId: string): Promise<WorkstationHistoryRecord[]> {
  requireOwner(ownerId)
  if (typeof indexedDB === 'undefined') return []
  const items = await runStore<StoredHistoryRecord[]>('readonly', (store) => store.index('ownerId').getAll(ownerId))
  return items.map(toRecord).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function recordWorkstationHistory(ownerId: string, record: WorkstationHistoryRecord) {
  requireOwner(ownerId)
  if (typeof indexedDB === 'undefined') return
  const stored = await toStored(ownerId, record)
  await runStore('readwrite', (store) => {
    store.put(stored)
    const request = store.index('ownerId').getAll(ownerId)
    request.onsuccess = () => {
      const extra = (request.result as StoredHistoryRecord[])
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(MAX_ITEMS)
      for (const item of extra) store.delete([ownerId, item.id])
    }
  })
}

export async function deleteWorkstationHistory(ownerId: string, id: string) {
  requireOwner(ownerId)
  if (typeof indexedDB === 'undefined') return
  await runStore('readwrite', (store) => store.delete([ownerId, id]))
}

export async function clearWorkstationHistory(ownerId: string) {
  requireOwner(ownerId)
  if (typeof indexedDB === 'undefined') return
  await runStore('readwrite', (store) => {
    const request = store.index('ownerId').openKeyCursor(ownerId)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) return
      store.delete(cursor.primaryKey)
      cursor.continue()
    }
  })
}
