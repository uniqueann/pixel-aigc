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
): Promise<T> {
  const db = await openDatabase()
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(store, mode)
    const request = operation(transaction.objectStore(store))
    transaction.oncomplete = () => { db.close(); resolve(request.result) }
    transaction.onabort = transaction.onerror = () => {
      db.close()
      reject(transaction.error ?? request.error ?? new Error('本地存储操作失败'))
    }
  })
}

let persistenceUser: string | undefined
export const setPersistenceUser = (id: string) => { persistenceUser = id }
export const persistenceScope = () => persistenceUser ?? 'anonymous'
const currentKey = () => persistenceUser ? `${persistenceUser}:current` : 'current'
export const readCurrentSnapshot = () => databaseOperation<unknown>('projects', 'readonly', store => store.get(currentKey()))
export async function writeCurrentSnapshot(snapshot: unknown) {
  const key = currentKey()
  const id = (snapshot as { project?: { id?: string } })?.project?.id
  if (id) await databaseOperation('projects', 'readwrite', store => store.put(snapshot, `${persistenceScope()}:project:${id}`))
  return databaseOperation('projects', 'readwrite', store => store.put(snapshot, key))
}
export const readLegacySnapshot = () => databaseOperation<unknown>('projects', 'readonly', store => store.get('current'))
export const saveConflictSnapshot = (snapshot: unknown) => databaseOperation('projects', 'readwrite', store => store.put(snapshot, `${persistenceScope()}:conflict:${crypto.randomUUID()}`))
