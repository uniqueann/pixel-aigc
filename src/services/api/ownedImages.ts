import { normalizeImageBlob } from '@shared/image-format'
import { readHistoryImage } from '@/features/assets/workstationHistory'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { useUserStore } from '@/store/useUserStore'
import { signedOwnedObject } from './objects'

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
const abortError = () => new DOMException('读取已取消', 'AbortError')
function check(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? abortError() }
function keyFor(ownerId: string, key: string) { return JSON.stringify([ownerId, key]) }
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
  const queuedAt = performance.now()
  return queued(signal, async () => {
    check(signal)
    const queueMs = Math.round(performance.now() - queuedAt)
    let signed = { url: reference.url, expiresAt: reference.expiresAt }
    let refreshes = 0
    const refresh = async () => {
      const started = performance.now()
      signed = await signedOwnedObject(reference.objectKey!, signal)
      refreshes++
      console.debug('[图片读取]', { operation: 'sign', elapsedMs: Math.round(performance.now() - started), refreshes })
    }
    if (!signed.url || (signed.expiresAt !== undefined && signed.expiresAt - Date.now() < 30_000)) await refresh()
    for (let attempt = 0; attempt < 2; attempt++) {
      check(signal)
      const timeout = new AbortController()
      const timer = setTimeout(() => timeout.abort(new OwnedImageReadError(504, '读取结果超时，请重试读取')), 60_000)
      const cancel = () => timeout.abort(signal.reason ?? abortError())
      signal.addEventListener('abort', cancel, { once: true })
      let retry: boolean
      try {
        // 只向本站签名接口发送令牌，R2 请求不携带鉴权头或 Cookie。
        console.debug('[图片读取]', { source: 'r2', operation: 'request', request: 1, queueMs, refreshes })
        const response = await fetch(signed.url!, { signal: timeout.signal, credentials: 'omit' })
        console.debug('[图片读取]', { source: 'r2', operation: 'headers', status: response.status })
        if (!response.ok) {
          await response.body?.cancel()
          if (response.status === 403 && attempt === 0) retry = true
          else throw new OwnedImageReadError(response.status, response.status === 404 ? '结果对象不存在' : '读取结果失败，请重试读取')
        } else {
          const blob = await normalizeImageBlob(await response.blob())
          check(signal)
          console.debug('[图片读取]', { source: 'r2', bytes: blob.size, queueMs, refreshes })
          return blob
        }
      } catch (error) {
        check(signal)
        if (timeout.signal.aborted) throw timeout.signal.reason
        if (error instanceof OwnedImageReadError) throw error
        // 过期签名的跨域响应可能表现为网络异常；只允许重新签名一次。
        if (attempt === 0 && error instanceof TypeError) retry = true
        else throw new OwnedImageReadError(502, '读取结果中断，请重试读取')
      } finally {
        clearTimeout(timer); signal.removeEventListener('abort', cancel)
      }
      if (retry) await refresh()
    }
    throw new OwnedImageReadError(502, '读取结果失败，请重试读取')
  })
}
async function load(reference: OwnedImageReference, ownerId: string, signal: AbortSignal) {
  let local: Blob | undefined
  try { local = await readHistoryImage(ownerId, { id: reference.historyId, objectKey: reference.objectKey }) }
  catch { /* 本地存储不可用时仍可读取远端结果。 */ }
  check(signal)
  if (local) {
    try {
      const blob = await normalizeImageBlob(local)
      console.debug('[图片读取]', { source: 'history', bytes: blob.size })
      return blob
    } catch { /* 历史图片损坏时允许从对象键恢复。 */ }
  }
  if (!reference.objectKey) throw new OwnedImageReadError(404, '本地历史图片不存在')
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
  if (!ownerId.trim()) throw new Error('缺少图片所属账号')
  if (reference.blob) {
    const blob = await normalizeImageBlob(reference.blob)
    check(options.signal)
    if (reference.mimeType && blob.type !== reference.mimeType) throw new OwnedImageReadError(502, '结果图片格式不符合要求')
    if (reference.objectKey) cacheBlob(keyFor(ownerId, reference.objectKey), blob)
    console.debug('[图片读取]', { source: 'blob', bytes: blob.size })
    return blob
  }
  const key = keyFor(ownerId, reference.objectKey ?? `history:${reference.historyId}`)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key); cache.set(key, cached)
    if (reference.mimeType && cached.type !== reference.mimeType) throw new OwnedImageReadError(502, '结果图片格式不符合要求')
    console.debug('[图片读取]', { source: 'memory', bytes: cached.size })
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
  if (reference.mimeType && blob.type !== reference.mimeType) throw new OwnedImageReadError(502, '结果图片格式不符合要求')
  return blob
}
