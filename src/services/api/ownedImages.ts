import { normalizeImageBlob } from '@shared/image-format'
import { readHistoryImage } from '@/features/assets/workstationHistory'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { i18n } from '@/i18n'
import { useUserStore } from '@/store/useUserStore'
import { fetchOwnedObject, OwnedObjectError } from './objects'

export interface OwnedImageReference {
  objectKey?: string
  blob?: Blob
  url?: string
  expiresAt?: number
  mimeType?: string
  historyId?: string
}
export class OwnedImageReadError extends Error {
  constructor(public status: number, message: string) { super(message); this.name = 'OwnedImageReadError' }
}
interface PendingRead { controller: AbortController; consumers: number; promise: Promise<Blob> }
const cache = new Map<string, Blob>()
const pending = new Map<string, PendingRead>()
let cachedBytes = 0
const queue: Array<{ start: () => void; signal: AbortSignal; reject: (error: unknown) => void }> = []
let downloading = 0
const abortError = () => new DOMException(i18n.t('errors:client.readCancelled'), 'AbortError')
function check(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? abortError() }
function keyFor(ownerId: string, key: string) { return JSON.stringify([ownerId, key]) }
function ownedObjectStatus(error: unknown): number | undefined {
  if (typeof OwnedObjectError === 'function' && error instanceof OwnedObjectError) return error.status
  if (error instanceof Error && error.name === 'OwnedObjectError') {
    const status = (error as { status?: unknown }).status
    if (typeof status === 'number') return status
  }
}
function cacheBlob(key: string, blob: Blob) {
  const budget = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 64 * 1024 * 1024 : 128 * 1024 * 1024
  if (blob.size > budget) return
  const previous = cache.get(key)
  if (previous) { cachedBytes -= previous.size; cache.delete(key) }
  cache.set(key, blob); cachedBytes += blob.size
  while (cache.size > 32 || cachedBytes > budget) {
    const oldest = cache.keys().next().value!
    cachedBytes -= cache.get(oldest)!.size
    cache.delete(oldest)
  }
}
export function invalidateOwnedImage(ownerId: string, objectKey: string) {
  const key = keyFor(ownerId, objectKey)
  const blob = cache.get(key)
  if (blob) { cache.delete(key); cachedBytes -= blob.size }
}
export function clearOwnedImageSession() {
  cache.clear(); cachedBytes = 0
  for (const item of pending.values()) item.controller.abort(abortError())
  pending.clear()
  pump()
}
useUserStore.subscribe((state, previous) => { if (state.userId !== previous.userId) clearOwnedImageSession() })
function pump() {
  while (downloading < 2 && queue.length) {
    const item = queue.shift()!
    if (item.signal.aborted) { item.reject(item.signal.reason ?? abortError()); continue }
    item.start()
  }
}
function queued<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const item = { signal, reject, start: () => {
      signal.removeEventListener('abort', cancel)
      downloading++
      void run().then(resolve, reject).finally(() => { downloading--; pump() })
    } }
    const cancel = () => {
      const index = queue.indexOf(item)
      if (index >= 0) queue.splice(index, 1)
      reject(signal.reason ?? abortError())
    }
    signal.addEventListener('abort', cancel, { once: true })
    queue.push(item); pump()
  })
}
async function remote(reference: OwnedImageReference, signal: AbortSignal): Promise<Blob> {
  if (!reference.objectKey) throw new OwnedImageReadError(404, i18n.t('errors:client.localHistoryMissing'))
  const queuedAt = performance.now()
  return queued(signal, async () => {
    check(signal)
    const queueMs = Math.round(performance.now() - queuedAt)
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(new OwnedImageReadError(504, i18n.t('errors:client.readResultTimeout'))), 60_000)
    const cancel = () => timeout.abort(signal.reason ?? abortError())
    signal.addEventListener('abort', cancel, { once: true })
    try {
      // Private object bytes flow via same-origin proxy to avoid direct CORS issues on R2 signed URLs.
      console.debug('[owned-image]', { source: 'proxy', operation: 'request', queueMs })
      const blob = await normalizeImageBlob(await fetchOwnedObject(reference.objectKey!, undefined, timeout.signal))
      check(signal)
      console.debug('[owned-image]', { source: 'proxy', bytes: blob.size, queueMs })
      return blob
    } catch (error) {
      check(signal)
      if (timeout.signal.aborted) throw timeout.signal.reason
      if (error instanceof OwnedImageReadError) throw error
      const status = ownedObjectStatus(error)
      if (status !== undefined) {
        throw new OwnedImageReadError(
          status,
          status === 404
            ? i18n.t('errors:client.resultNotFound')
            : error instanceof Error ? error.message : i18n.t('errors:client.readResultFailed'),
        )
      }
      throw new OwnedImageReadError(502, i18n.t('errors:client.readResultInterrupted'))
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', cancel)
    }
  })
}
async function load(reference: OwnedImageReference, ownerId: string, signal: AbortSignal) {
  let local: Blob | undefined
  try { local = await readHistoryImage(ownerId, { id: reference.historyId, objectKey: reference.objectKey }) }
  catch { /* Remote object recovery still works when local IndexedDB is unavailable. */ }
  check(signal)
  if (local) {
    try {
      const blob = await normalizeImageBlob(local)
      console.debug('[owned-image]', { source: 'history', bytes: blob.size })
      return blob
    } catch { /* Fall back to remote object key when history blob is corrupted. */ }
  }
  if (!reference.objectKey) throw new OwnedImageReadError(404, i18n.t('errors:client.localHistoryMissing'))
  return remote(reference, signal)
}
function consume(item: PendingRead, signal?: AbortSignal) {
  if (signal?.aborted && item.consumers === 0) item.controller.abort(signal.reason ?? abortError())
  check(signal)
  item.consumers++
  return new Promise<Blob>((resolve, reject) => {
    let settled = false
    const release = () => {
      if (settled) return false
      settled = true; signal?.removeEventListener('abort', cancel)
      if (--item.consumers === 0) item.controller.abort(abortError())
      return true
    }
    const cancel = () => { if (release()) reject(signal?.reason ?? abortError()) }
    signal?.addEventListener('abort', cancel, { once: true })
    item.promise.then(blob => { if (release()) resolve(blob) }, error => { if (release()) reject(error) })
  })
}
export async function readOwnedImage(reference: OwnedImageReference, options: { ownerId?: string; signal?: AbortSignal } = {}): Promise<Blob> {
  check(options.signal)
  const ownerId = options.ownerId ?? currentWorkstationHistoryOwner()
  if (!ownerId.trim()) throw new Error(i18n.t('errors:client.missingImageOwner'))
  if (reference.blob) {
    const blob = await normalizeImageBlob(reference.blob)
    check(options.signal)
    if (reference.mimeType && blob.type !== reference.mimeType) throw new OwnedImageReadError(502, i18n.t('errors:client.invalidResultFormat'))
    if (reference.objectKey) cacheBlob(keyFor(ownerId, reference.objectKey), blob)
    console.debug('[owned-image]', { source: 'blob', bytes: blob.size })
    return blob
  }
  const key = keyFor(ownerId, reference.objectKey ?? `history:${reference.historyId}`)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key); cache.set(key, cached)
    if (reference.mimeType && cached.type !== reference.mimeType) throw new OwnedImageReadError(502, i18n.t('errors:client.invalidResultFormat'))
    console.debug('[owned-image]', { source: 'memory', bytes: cached.size })
    return cached
  }
  let item = pending.get(key)
  if (item?.controller.signal.aborted) { pending.delete(key); item = undefined }
  if (!item) {
    const controller = new AbortController()
    item = { controller, consumers: 0, promise: Promise.resolve(new Blob()) }
    const current = item
    item.promise = load(reference, ownerId, controller.signal).then(blob => {
      check(controller.signal); cacheBlob(key, blob); return blob
    }).finally(() => { if (pending.get(key) === current) pending.delete(key) })
    pending.set(key, item)
  }
  const blob = await consume(item, options.signal)
  if (reference.mimeType && blob.type !== reference.mimeType) throw new OwnedImageReadError(502, i18n.t('errors:client.invalidResultFormat'))
  return blob
}
