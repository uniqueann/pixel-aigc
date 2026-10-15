import { readBlobBytes } from '@shared/image-format'
import type { TaskInputUploadMetrics, uploadTaskInput } from '@/services/api/upload'

export const BG_REMOVE_SOURCE_CACHE_MS = 30 * 60_000
export const BG_REMOVE_SOURCE_CACHE_LIMIT = 20
export const BG_REMOVE_UPLOAD_CONCURRENCY = 2

export interface BgRemoveSourceMetrics {
  source: 'upload' | 'cache' | 'inflight'
  fingerprint: 'sha256' | 'identity'
  hashMs: number
  queueMs: number
  elapsedMs: number
  outcome: 'success' | 'failed' | 'cancelled'
  upload?: TaskInputUploadMetrics
}
interface ReadOptions {
  scope: string
  signal?: AbortSignal
  onMetrics?: (metrics: BgRemoveSourceMetrics) => void
}
interface SourceEntry {
  controller: AbortController
  consumers: number
  promise: Promise<string>
  objectKey?: string
  expiresAt?: number
  queueMs: number
  upload?: TaskInputUploadMetrics
}
interface UploadQueueItem {
  signal: AbortSignal
  start: () => void
}
const cancelled = () => new DOMException('图片上传已取消', 'AbortError')
function check(signal?: AbortSignal) { if (signal?.aborted) throw signal.reason ?? cancelled() }

/** 仅在当前账号和环境的内存会话中缓存内容摘要、对象键，不缓存图片或签名地址。 */
export class BgRemoveSourceUploads {
  private scope?: string
  private epoch = 0
  private entries = new Map<string, SourceEntry>()
  private fingerprints = new WeakMap<Blob, Promise<{ key: string; kind: 'sha256' | 'identity' }>>()
  private nextIdentity = 0
  private queue: UploadQueueItem[] = []
  private uploading = 0

  constructor(private upload: typeof uploadTaskInput, private now = Date.now) {}

  clear() {
    this.epoch++
    for (const entry of this.entries.values()) entry.controller.abort(cancelled())
    this.entries.clear()
    this.fingerprints = new WeakMap()
    this.scope = undefined
  }

  invalidate(scope: string, objectKey: string) {
    if (this.scope !== scope) return
    for (const [key, entry] of this.entries) {
      if (entry.objectKey === objectKey) this.entries.delete(key)
    }
  }

  private fingerprint(file: Blob) {
    let pending = this.fingerprints.get(file)
    if (!pending) {
      pending = (async () => {
        if (typeof crypto !== 'undefined' && crypto.subtle?.digest) {
          const digest = await crypto.subtle.digest('SHA-256', await readBlobBytes(file))
          const hex = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('')
          return { key: `${file.type}:${file.size}:${hex}`, kind: 'sha256' as const }
        }
        // 缺少安全摘要能力时只复用同一个 Blob 实例，不根据名称、大小等弱特征误判。
        return { key: `identity:${++this.nextIdentity}`, kind: 'identity' as const }
      })()
      this.fingerprints.set(file, pending)
      void pending.catch(() => { if (this.fingerprints.get(file) === pending) this.fingerprints.delete(file) })
    }
    return pending
  }

  private pump() {
    while (this.uploading < BG_REMOVE_UPLOAD_CONCURRENCY && this.queue.length) {
      const item = this.queue.shift()!
      if (!item.signal.aborted) item.start()
    }
  }

  private queued(entry: SourceEntry, file: Blob): Promise<string> {
    const signal = entry.controller.signal
    const queuedAt = performance.now()
    return new Promise((resolve, reject) => {
      const item: UploadQueueItem = { signal, start: () => {
        signal.removeEventListener('abort', abort)
        this.uploading++
        entry.queueMs = Math.round(performance.now() - queuedAt)
        void Promise.resolve().then(() => {
          check(signal)
          return this.upload(file, file.type, signal, { onMetrics: metrics => { entry.upload = metrics } })
        }).then(resolve, reject).finally(() => { this.uploading--; this.pump() })
      } }
      const abort = () => {
        const index = this.queue.indexOf(item)
        if (index >= 0) this.queue.splice(index, 1)
        reject(signal.reason ?? cancelled())
      }
      signal.addEventListener('abort', abort, { once: true })
      this.queue.push(item)
      if (signal.aborted) abort()
      else this.pump()
    })
  }

  private trim() {
    let completed = [...this.entries.values()].filter(entry => entry.objectKey).length
    for (const [key, entry] of this.entries) {
      if (completed <= BG_REMOVE_SOURCE_CACHE_LIMIT) break
      if (entry.objectKey) { this.entries.delete(key); completed-- }
    }
  }

  private consume(key: string, entry: SourceEntry, signal?: AbortSignal) {
    check(signal)
    entry.consumers++
    return new Promise<string>((resolve, reject) => {
      let finished = false
      const finish = (error?: unknown, objectKey?: string) => {
        if (finished) return
        finished = true
        signal?.removeEventListener('abort', abort)
        entry.controller.signal.removeEventListener('abort', invalidate)
        entry.consumers--
        if (!entry.consumers && !entry.objectKey) {
          if (this.entries.get(key) === entry) this.entries.delete(key)
          entry.controller.abort(cancelled())
        }
        if (error) reject(error)
        else resolve(objectKey!)
      }
      const abort = () => finish(signal?.reason ?? cancelled())
      const invalidate = () => finish(entry.controller.signal.reason ?? cancelled())
      signal?.addEventListener('abort', abort, { once: true })
      entry.controller.signal.addEventListener('abort', invalidate, { once: true })
      if (signal?.aborted) abort()
      else if (entry.controller.signal.aborted) invalidate()
      else entry.promise.then(value => finish(undefined, value), error => finish(error))
    })
  }

  async read(file: Blob, options: ReadOptions): Promise<string> {
    check(options.signal)
    if (this.scope !== options.scope) { this.clear(); this.scope = options.scope }
    const epoch = this.epoch
    const started = performance.now()
    const metrics: BgRemoveSourceMetrics = {
      source: 'upload', fingerprint: 'identity', hashMs: 0, queueMs: 0, elapsedMs: 0, outcome: 'failed',
    }
    let entry: SourceEntry | undefined
    try {
      const fingerprint = await this.fingerprint(file)
      metrics.hashMs = Math.round(performance.now() - started)
      metrics.fingerprint = fingerprint.kind
      check(options.signal)
      if (this.epoch !== epoch || this.scope !== options.scope) throw cancelled()
      const key = fingerprint.key
      entry = this.entries.get(key)
      if (entry?.objectKey && this.now() >= entry.expiresAt!) { this.entries.delete(key); entry = undefined }
      if (entry?.objectKey) {
        this.entries.delete(key); this.entries.set(key, entry)
        metrics.source = 'cache'; metrics.outcome = 'success'
        return entry.objectKey
      }
      if (entry) metrics.source = 'inflight'
      else {
        entry = { controller: new AbortController(), consumers: 0, promise: Promise.resolve(''), queueMs: 0 }
        const current = entry
        this.entries.set(key, current)
        current.promise = this.queued(current, file).then(objectKey => {
          check(current.controller.signal)
          if (this.epoch !== epoch || this.entries.get(key) !== current) throw cancelled()
          current.objectKey = objectKey
          current.expiresAt = this.now() + BG_REMOVE_SOURCE_CACHE_MS
          this.trim()
          return objectKey
        }).catch(error => {
          if (this.entries.get(key) === current) this.entries.delete(key)
          throw error
        })
      }
      const objectKey = await this.consume(key, entry, options.signal)
      metrics.outcome = 'success'
      return objectKey
    } catch (error) {
      metrics.outcome = options.signal?.aborted || this.epoch !== epoch || entry?.controller.signal.aborted
        ? 'cancelled' : 'failed'
      throw error
    } finally {
      if (metrics.source !== 'cache' && entry) { metrics.queueMs = entry.queueMs; metrics.upload = entry.upload }
      metrics.elapsedMs = Math.round(performance.now() - started)
      options.onMetrics?.(metrics)
    }
  }
}
