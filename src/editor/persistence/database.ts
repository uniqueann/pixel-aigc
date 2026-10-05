import { rememberSavedProject } from '@/features/dashboard/recentWork'

const DATABASE_NAME = 'pixel-aigc-projects'
export type StoreName = 'projects' | 'mockTasks'

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      for (const name of ['projects', 'mockTasks']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name)
      }
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地存储'))
    request.onblocked = () => reject(new Error('本地存储正在升级，请关闭其他页面后重试'))
    request.onsuccess = () => resolve(request.result)
  })
}

/** 仅在事务提交后返回成功，避免把请求成功误认为已保存。 */
export async function databaseOperation<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
  signal?: AbortSignal,
): Promise<T> {
  signal?.throwIfAborted()
  const db = await openDatabase()
  if (signal?.aborted) { db.close(); signal.throwIfAborted() }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const abort = () => { try { transaction.abort() } catch { /* 已提交的事务无需再次取消。 */ } }
    signal?.addEventListener('abort', abort, { once: true })
    let request: IDBRequest<T> | undefined
    transaction.oncomplete = () => { signal?.removeEventListener('abort', abort); db.close(); resolve(request!.result) }
    transaction.onabort = transaction.onerror = () => {
      signal?.removeEventListener('abort', abort)
      db.close()
      reject(signal?.aborted ? signal.reason : transaction.error ?? request?.error ?? new Error('本地存储操作失败'))
    }
    try { request = operation(transaction.objectStore(store)) }
    catch (error) { signal?.removeEventListener('abort', abort); abort(); db.close(); reject(error) }
  })
}

let persistenceUser: string | undefined
export const setPersistenceUser = (id: string) => { persistenceUser = id }
export const persistenceScope = () => persistenceUser ?? 'anonymous'
const currentKey = () => persistenceUser ? `${persistenceUser}:current` : 'current'
export const readCurrentSnapshot = () => databaseOperation<unknown>('projects', 'readonly', store => store.get(currentKey()))
export const readSavedProjectSnapshot = (id: string, ownerId = persistenceScope()) =>
  databaseOperation<unknown>('projects', 'readonly', store => store.get(`${ownerId}:project:${id}`))
export async function writeCurrentSnapshot(snapshot: unknown, signal?: AbortSignal) {
  const key = currentKey()
  const ownerId = persistenceScope()
  const id = (snapshot as { project?: { id?: string } })?.project?.id
  const result = await databaseOperation('projects', 'readwrite', store => {
    if (id) store.put(snapshot, `${ownerId}:project:${id}`)
    return store.put(snapshot, key)
  }, signal)
  if (id) rememberSavedProject(ownerId, snapshot as Parameters<typeof rememberSavedProject>[1])
  return result
}
export const readLegacySnapshot = () => databaseOperation<unknown>('projects', 'readonly', store => store.get('current'))
export const saveConflictSnapshot = (snapshot: unknown) => databaseOperation('projects', 'readwrite', store => store.put(snapshot, `${persistenceScope()}:conflict:${crypto.randomUUID()}`))
