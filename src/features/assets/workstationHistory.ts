import { detectImageMime, readBlobBytes } from '@shared/image-format'
import { Capability } from '@/types'

const DATABASE_NAME = 'pixel-aigc-history-v2'
const ORIGINALS = 'workstationResults'
const METADATA = 'metadata'
const THUMBNAILS = 'thumbnails'
const DELETED = 'deletedResults'
const STORES = [ORIGINALS, METADATA, THUMBNAILS, DELETED]
export const HISTORY_LIMIT = 50
export const HISTORY_CHANGED = 'pixel-history-changed'
export type WorkstationHistorySlug = 'repaint' | 'remove' | 'outpaint' | 'smart-edit' | string

export interface WorkstationHistoryMetadata {
  mediaType?: 'image' | 'video'
  video?: Omit<import('@shared/video-models').VideoResult, 'url' | 'expiresAt'>
  id: string
  objectKey?: string
  taskId?: string
  ordinal?: number
  toolSlug: WorkstationHistorySlug
  capability: Capability
  prompt?: string
  width: number
  height: number
  mimeType: string
  createdAt: string
  updatedAt: string
}
export interface WorkstationHistoryRecord extends WorkstationHistoryMetadata { result: Blob }
export interface WorkstationHistoryListItem extends WorkstationHistoryMetadata { thumbnail?: Blob }
interface StoredOriginal extends WorkstationHistoryMetadata { ownerId: string; result?: Blob; resultBytes?: ArrayBuffer }
interface DeletedResult { ownerId: string; id: string; objectKey?: string; taskId?: string }

function requireOwner(ownerId: string) {
  if (!ownerId.trim()) throw new Error('缺少历史记录所属账号')
  if (typeof indexedDB === 'undefined') throw new Error('浏览器不支持本地历史，当前图片尚未保存')
}
function metadata(stored: StoredOriginal): WorkstationHistoryMetadata & { ownerId: string } {
  const { result: _blob, resultBytes: _bytes, ...fields } = stored
  void _blob; void _bytes
  return fields
}
export function compareHistory(left: WorkstationHistoryMetadata, right: WorkstationHistoryMetadata) {
  return right.createdAt.localeCompare(left.createdAt) || left.id.localeCompare(right.id)
}

export function openHistoryDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let blocked = false
    const request = indexedDB.open(DATABASE_NAME, 2)
    request.onupgradeneeded = () => {
      const db = request.result
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: ['ownerId', 'id'] })
          store.createIndex('ownerId', 'ownerId')
          if (name === METADATA) store.createIndex('objectKey', ['ownerId', 'objectKey'])
        }
      }
      // 升级只逐条复制轻量字段，旧原图保留；缩略图在事务结束后按需补齐。
      const tx = request.transaction!
      const cursor = tx.objectStore(ORIGINALS).openCursor()
      cursor.onsuccess = () => {
        if (!cursor.result) return
        tx.objectStore(METADATA).put(metadata(cursor.result.value as StoredOriginal))
        cursor.result.continue()
      }
    }
    request.onerror = () => reject(request.error ?? new Error('无法打开本地历史'))
    request.onblocked = () => { blocked = true; reject(new Error('本地历史正在升级，请关闭其他页面后重试')) }
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return }
      // 若升级曾被其他标签阻塞且本次调用已失败，仍及时释放后来打开的连接。
      request.result.onversionchange = () => request.result.close()
      resolve(request.result)
    }
  })
}
async function transaction<T>(names: string[], mode: IDBTransactionMode, operation: (tx: IDBTransaction, complete: (value: T) => void, fail: (error: unknown) => void) => void) {
  const db = await openHistoryDatabase()
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(names, mode)
    let value: T
    let operationError: unknown
    const fail = (error: unknown) => { operationError = error; tx.abort() }
    tx.oncomplete = () => { db.close(); resolve(value) }
    tx.onabort = tx.onerror = () => { db.close(); reject(operationError ?? tx.error ?? new Error('本地历史操作失败，当前图片尚未保存')) }
    try { operation(tx, result => { value = result }, fail) } catch (error) { tx.abort(); db.close(); reject(error) }
  })
}
function changed(ownerId: string) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(HISTORY_CHANGED, { detail: ownerId }))
  if (typeof window !== 'undefined' && typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel(HISTORY_CHANGED)
    channel.postMessage(ownerId)
    channel.close()
  }
}

export async function listHistoryMetadata(ownerId: string, includeVideos = false): Promise<WorkstationHistoryMetadata[]> {
  requireOwner(ownerId)
  if (includeVideos) await pruneExpiredVideos(ownerId)
  return transaction([METADATA], 'readonly', (tx, done) => {
    const request = tx.objectStore(METADATA).index('ownerId').getAll(ownerId)
    request.onsuccess = () => done(request.result.map(({ ownerId: _ownerId, ...fields }) => { void _ownerId; return fields })
      .filter((item: WorkstationHistoryMetadata) => item.mediaType !== 'video' || (includeVideos && !!item.video && new Date(item.video.retentionExpiresAt).getTime() > Date.now())).sort(compareHistory))
  })
}

/** 到期删除本地视频引用；保留画布中的过期提示，不再恢复播放地址。 */
export async function pruneExpiredVideos(ownerId: string) {
  requireOwner(ownerId)
  await transaction([METADATA, THUMBNAILS], 'readwrite', (tx, done) => {
    const request = tx.objectStore(METADATA).index('ownerId').openCursor(ownerId)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) { done(undefined); return }
      const item = cursor.value as WorkstationHistoryMetadata
      if (item.mediaType === 'video' && !(new Date(item.video?.retentionExpiresAt ?? '').getTime() > Date.now())) {
        cursor.delete()
        tx.objectStore(THUMBNAILS).delete([ownerId, item.id])
      }
      cursor.continue()
    }
  })
}
export async function readHistoryImage(ownerId: string, reference: { id?: string; objectKey?: string }): Promise<Blob | undefined> {
  requireOwner(ownerId)
  const stored = await transaction<StoredOriginal | undefined>([ORIGINALS, METADATA], 'readonly', (tx, done) => {
    const read = (id: string) => {
      const request = tx.objectStore(ORIGINALS).get([ownerId, id])
      request.onsuccess = () => done(request.result)
    }
    if (reference.id) read(reference.id)
    else if (reference.objectKey) {
      const request = tx.objectStore(METADATA).index('objectKey').get([ownerId, reference.objectKey])
      request.onsuccess = () => request.result ? read(request.result.id) : done(undefined)
    } else done(undefined)
  })
  if (!stored) return undefined
  if (reference.objectKey && stored.objectKey && stored.objectKey !== reference.objectKey) return undefined
  if (stored.result) return stored.result
  if (!stored.resultBytes) return undefined
  const mimeType = detectImageMime(new Uint8Array(stored.resultBytes, 0, Math.min(32, stored.resultBytes.byteLength))) ?? stored.mimeType
  return new Blob([stored.resultBytes], { type: mimeType })
}

// 兼容需要完整原图的旧调用；列表应使用 listHistoryPreviews。
export async function listWorkstationHistory(ownerId: string): Promise<WorkstationHistoryRecord[]> {
  const items = await listHistoryMetadata(ownerId)
  const result: WorkstationHistoryRecord[] = []
  for (const item of items) {
    const blob = await readHistoryImage(ownerId, { id: item.id })
    if (blob) result.push({ ...item, mimeType: blob.type, result: blob })
  }
  return result
}

const thumbnailQueue: Array<{ ownerId: string; id: string; blob?: Blob; size?: { width: number; height: number } }> = []
const scheduledThumbnails = new Set<string>()
let makingThumbnail = false
function enqueueThumbnail(ownerId: string, id: string, blob?: Blob, size?: { width: number; height: number }) {
  if (typeof createImageBitmap !== 'function') return
  const key = `${ownerId}:${id}`
  if (scheduledThumbnails.has(key)) return
  scheduledThumbnails.add(key)
  thumbnailQueue.push({ ownerId, id, blob, size })
  void makeThumbnails()
}
async function makeThumbnails() {
  if (makingThumbnail) return
  makingThumbnail = true
  try {
    while (thumbnailQueue.length) {
      const item = thumbnailQueue.shift()!
      let bitmap: ImageBitmap | undefined
      try {
        const blob = item.blob ?? await readHistoryImage(item.ownerId, { id: item.id })
        if (!blob) continue
        // 解码时就限制尺寸，避免 50 张大图逐张产生完整分辨率的临时位图。
        const resize = item.size && item.size.width > 0 && item.size.height > 0 ? Math.min(1, 320 / Math.max(item.size.width, item.size.height)) : undefined
        bitmap = await createImageBitmap(blob, resize ? { resizeWidth: Math.max(1, Math.round(item.size!.width * resize)), resizeHeight: Math.max(1, Math.round(item.size!.height * resize)), resizeQuality: 'high', imageOrientation: 'from-image' } : undefined)
        const scale = Math.min(1, 320 / Math.max(bitmap.width, bitmap.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale))
        const context = canvas.getContext('2d')
        if (!context) continue
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const thumbnail = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
        if (!thumbnail) continue
        await transaction([METADATA, THUMBNAILS], 'readwrite', (tx, done) => {
          const exists = tx.objectStore(METADATA).get([item.ownerId, item.id])
          exists.onsuccess = () => {
            if (exists.result) tx.objectStore(THUMBNAILS).put({ ownerId: item.ownerId, id: item.id, thumbnail })
            done(undefined)
          }
        })
        changed(item.ownerId)
      } catch { /* 缩略图失败只显示占位图，不影响完整图片。 */ }
      finally { bitmap?.close() }
    }
  } finally { makingThumbnail = false }
}
export async function listHistoryPreviews(ownerId: string, includeVideos = false): Promise<WorkstationHistoryListItem[]> {
  const items = await listHistoryMetadata(ownerId, includeVideos)
  const thumbnails = await transaction<Array<{ id: string; thumbnail: Blob }>>([THUMBNAILS], 'readonly', (tx, done) => {
    const request = tx.objectStore(THUMBNAILS).index('ownerId').getAll(ownerId)
    request.onsuccess = () => done(request.result)
  })
  const byId = new Map(thumbnails.map(item => [item.id, item.thumbnail]))
  for (const item of items) if (item.mediaType !== 'video' && !byId.has(item.id)) enqueueThumbnail(ownerId, item.id, undefined, item)
  return items.map(item => ({ ...item, thumbnail: byId.get(item.id) }))
}
export async function listHistoryDeletions(ownerId: string): Promise<DeletedResult[]> {
  requireOwner(ownerId)
  return transaction([DELETED], 'readonly', (tx, done) => {
    const request = tx.objectStore(DELETED).index('ownerId').getAll(ownerId)
    request.onsuccess = () => done(request.result)
  })
}
export async function recordWorkstationHistory(ownerId: string, record: WorkstationHistoryRecord) {
  requireOwner(ownerId)
  const started = performance.now()
  const mimeType = detectImageMime(new Uint8Array(await readBlobBytes(record.result.slice(0, 32)))) ?? record.mimeType
  const stored = { ...record, mimeType, result: record.result.type === mimeType ? record.result : record.result.slice(0, record.result.size, mimeType), ownerId }
  let savedId = record.id
  let saved = false
  await transaction(STORES, 'readwrite', (tx, done, fail) => {
    const write = (id: string) => {
      const deletions = tx.objectStore(DELETED).index('ownerId').getAll(ownerId)
      deletions.onsuccess = () => {
        if (deletions.result.some(item => item.id === id || (record.objectKey && item.objectKey === record.objectKey))) { done(undefined); return }
        savedId = id
        try {
          tx.objectStore(ORIGINALS).put({ ...stored, id })
          tx.objectStore(METADATA).put({ ...metadata(stored), id })
        } catch (error) { fail(error); return }
        const request = tx.objectStore(METADATA).index('ownerId').getAll(ownerId)
        request.onsuccess = () => {
          for (const extra of request.result.filter((item: WorkstationHistoryMetadata) => item.mediaType !== 'video').sort(compareHistory).slice(HISTORY_LIMIT)) {
            for (const name of [ORIGINALS, METADATA, THUMBNAILS]) tx.objectStore(name).delete([ownerId, extra.id])
          }
          saved = true
          done(undefined)
        }
      }
    }
    if (record.objectKey) {
      const existing = tx.objectStore(METADATA).index('objectKey').get([ownerId, record.objectKey])
      existing.onsuccess = () => write(existing.result?.id ?? record.id)
    } else write(record.id)
  })
  console.debug('[图片历史]', { operation: 'save', elapsedMs: Math.round(performance.now() - started), bytes: record.result.size })
  changed(ownerId)
  if (saved) enqueueThumbnail(ownerId, savedId, undefined, record)
}

/** 视频只保存轻量元数据，既不读取 MP4，也不挤占图片的原件存储额度。 */
export async function recordVideoHistory(ownerId: string, record: WorkstationHistoryMetadata) {
  requireOwner(ownerId)
  if (record.mediaType !== 'video' || !record.video || new Date(record.video.retentionExpiresAt).getTime() <= Date.now()) return
  let saved = false
  await transaction([METADATA, DELETED], 'readwrite', (tx, done) => {
    const deleted = tx.objectStore(DELETED).index('ownerId').getAll(ownerId)
    deleted.onsuccess = () => {
      if (deleted.result.some(item => item.id === record.id || item.objectKey === record.objectKey)) { done(undefined); return }
      const old = tx.objectStore(METADATA).get([ownerId, record.id])
      old.onsuccess = () => {
        if (old.result?.updatedAt !== record.updatedAt) { tx.objectStore(METADATA).put({ ...record, ownerId }); saved = true }
        done(undefined)
      }
    }
  })
  if (saved) changed(ownerId)
}
/** 只在同一任务版本中确认位置后补齐身份，不读取或复制原图。 */
export async function associateHistoryResult(ownerId: string, id: string, association: { taskId: string; ordinal?: number; objectKey: string; updatedAt: string }) {
  requireOwner(ownerId)
  await transaction([METADATA, ORIGINALS], 'readwrite', (tx, done) => {
    const request = tx.objectStore(METADATA).get([ownerId, id])
    request.onsuccess = () => {
      const item = request.result as WorkstationHistoryMetadata | undefined
      if (!item || item.updatedAt !== association.updatedAt || item.objectKey) { done(undefined); return }
      tx.objectStore(METADATA).put({ ...item, ...association, ownerId })
      const original = tx.objectStore(ORIGINALS).get([ownerId, id])
      original.onsuccess = () => {
        if (original.result) tx.objectStore(ORIGINALS).put({ ...original.result, ...association })
        done(undefined)
      }
    }
  })
}

export async function deleteWorkstationHistory(ownerId: string, id: string) {
  requireOwner(ownerId)
  await transaction(STORES, 'readwrite', (tx, done) => {
    const request = tx.objectStore(METADATA).get([ownerId, id])
    request.onsuccess = () => {
      const item = request.result as WorkstationHistoryMetadata | undefined
      tx.objectStore(DELETED).put({ ownerId, id, objectKey: item?.objectKey, taskId: item?.taskId ?? id.replace(/:(?:o)?\d+$/, '') })
      for (const name of [ORIGINALS, METADATA, THUMBNAILS]) tx.objectStore(name).delete([ownerId, id])
      done(undefined)
    }
  })
  changed(ownerId)
}
export async function clearWorkstationHistory(ownerId: string) {
  for (const item of await listHistoryMetadata(ownerId)) await deleteWorkstationHistory(ownerId, item.id)
}
