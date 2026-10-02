import type { BatchImage, SubjectDetection } from './types'
import { detectImageSubject } from './subjectClient'
import { checkDetectionSignal } from '@/services/api/detectionTiming'

type Image = Pick<BatchImage, 'file' | 'width' | 'height'>
type Detect = (image: Image, options?: { signal?: AbortSignal }) => Promise<SubjectDetection>
interface Entry {
  fileId: number
  controller: AbortController
  promise: Promise<SubjectDetection>
  users: number
  value?: SubjectDetection
  expiresAt?: number
}
export const SUBJECT_CACHE_MS = 30 * 60_000
export const SUBJECT_EMPTY_CACHE_MS = 5 * 60_000
const CACHE_LIMIT = 20
const DETECTION_VERSION = 1
const cancelled = () => new DOMException('检测已取消', 'AbortError')
const copy = (value: SubjectDetection): SubjectDetection => ({ box: value.box ? { ...value.box } : null })

/** 当前页面只保留主体框；File 身份使用弱引用，不缓存图片副本。 */
export class SubjectDetectionCache {
  private entries = new Map<string, Entry>()
  private identities = new WeakMap<File, number>()
  private nextId = 0
  constructor(private ownerId: string, private readonly detect: Detect = detectImageSubject) {}
  setOwner(ownerId: string) {
    if (this.ownerId !== ownerId) { this.clear(); this.ownerId = ownerId }
  }
  clear() {
    for (const entry of this.entries.values()) entry.controller.abort(cancelled())
    this.entries.clear()
  }
  remove(file: File) {
    const id = this.identities.get(file)
    for (const [key, entry] of this.entries) {
      if (entry.fileId === id) { this.entries.delete(key); entry.controller.abort(cancelled()) }
    }
  }
  read(image: Image, options: { signal?: AbortSignal } = {}): Promise<SubjectDetection> {
    const started = performance.now()
    checkDetectionSignal(options.signal)
    let id = this.identities.get(image.file)
    if (id === undefined) { id = ++this.nextId; this.identities.set(image.file, id) }
    const key = [this.ownerId, id, image.width, image.height, DETECTION_VERSION].join(':')
    let entry = this.entries.get(key)
    if (entry?.value && Date.now() >= entry.expiresAt!) { this.entries.delete(key); entry = undefined }
    if (entry?.value) {
      this.entries.delete(key); this.entries.set(key, entry)
      console.debug('[主体检测]', { source: 'cache', outcome: 'success', requestCount: 0, requestBytes: 0, elapsedMs: Math.round(performance.now() - started) })
      return Promise.resolve(copy(entry.value))
    }
    const merged = !!entry
    if (!entry) {
      const controller = new AbortController()
      entry = { fileId: id, controller, users: 0, promise: Promise.resolve({ box: null }) }
      const current = entry
      this.entries.set(key, current)
      current.promise = Promise.resolve().then(() => {
        checkDetectionSignal(controller.signal)
        return this.detect(image, { signal: controller.signal })
      }).then(value => {
        checkDetectionSignal(controller.signal)
        if (this.entries.get(key) !== current) throw cancelled()
        current.value = copy(value)
        current.expiresAt = Date.now() + (value.box ? SUBJECT_CACHE_MS : SUBJECT_EMPTY_CACHE_MS)
        return copy(value)
      }).catch(error => {
        if (this.entries.get(key) === current) this.entries.delete(key)
        throw error
      })
      while (this.entries.size > CACHE_LIMIT) {
        const oldest = this.entries.keys().next().value!
        const evicted = this.entries.get(oldest)!
        this.entries.delete(oldest); evicted.controller.abort(cancelled())
      }
    }
    const current = entry
    current.users++
    return new Promise((resolve, reject) => {
      let finished = false
      const finish = (error?: unknown, value?: SubjectDetection) => {
        if (finished) return
        finished = true
        if (merged || error) console.debug('[主体检测]', { source: merged ? 'inflight' : 'preparation', outcome: error ? (current.controller.signal.aborted || options.signal?.aborted ? 'cancelled' : 'failed') : 'success', requestCount: 0, requestBytes: 0, elapsedMs: Math.round(performance.now() - started) })
        options.signal?.removeEventListener('abort', abort)
        current.controller.signal.removeEventListener('abort', invalidate)
        current.users--
        if (!current.users && !current.value) {
          if (this.entries.get(key) === current) this.entries.delete(key)
          current.controller.abort(cancelled())
        }
        if (error) reject(error)
        else resolve(copy(value!))
      }
      const abort = () => finish(options.signal?.reason ?? cancelled())
      const invalidate = () => finish(current.controller.signal.reason ?? cancelled())
      options.signal?.addEventListener('abort', abort, { once: true })
      current.controller.signal.addEventListener('abort', invalidate, { once: true })
      if (options.signal?.aborted) abort()
      else if (current.controller.signal.aborted) invalidate()
      else current.promise.then(value => finish(undefined, value), error => finish(error))
    })
  }
}
