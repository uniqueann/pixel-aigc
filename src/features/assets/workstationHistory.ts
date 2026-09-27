import { Capability } from '@/types'

const DATABASE_NAME = 'pixel-aigc-history'
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
  resultBytes: ArrayBuffer
}

function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
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
  return {
    ...stored,
    result: new Blob([stored.resultBytes], { type: stored.mimeType }),
  }
}

function readBlobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') return blob.arrayBuffer()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error ?? new Error('读取结果失败'))
    reader.readAsArrayBuffer(blob)
  })
}

async function toStored(record: WorkstationHistoryRecord): Promise<StoredHistoryRecord> {
  return {
    id: record.id,
    toolSlug: record.toolSlug,
    capability: record.capability,
    prompt: record.prompt,
    width: record.width,
    height: record.height,
    mimeType: record.mimeType,
    resultBytes: await readBlobBytes(record.result),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  }
}

export async function listWorkstationHistory(): Promise<WorkstationHistoryRecord[]> {
  if (typeof indexedDB === 'undefined') return []
  const items = await runStore<StoredHistoryRecord[]>('readonly', (store) => store.getAll())
  return items.map(toRecord).sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

export async function recordWorkstationHistory(record: WorkstationHistoryRecord) {
  if (typeof indexedDB === 'undefined') return
  const stored = await toStored(record)
  await runStore('readwrite', (store) => store.put(stored))
  const items = await runStore<StoredHistoryRecord[]>('readonly', (store) => store.getAll())
  if (items.length <= MAX_ITEMS) return
  const extra = items.sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(MAX_ITEMS)
  await runStore('readwrite', (store) => {
    for (const item of extra) store.delete(item.id)
  })
}

export async function deleteWorkstationHistory(id: string) {
  if (typeof indexedDB === 'undefined') return
  await runStore('readwrite', (store) => store.delete(id))
}

export async function clearWorkstationHistory() {
  if (typeof indexedDB === 'undefined') return
  await runStore('readwrite', (store) => store.clear())
}
