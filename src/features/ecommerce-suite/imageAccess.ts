import { CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import type { SuiteClient } from './api'

export type SuiteImageVariant = 'original' | 'thumbnail'
export const SUITE_IMAGE_REFRESH_MARGIN_MS = 30_000
const THUMBNAIL_FALLBACK_TTL_MS = 60_000

interface AccessEntry { url: string; expiresAt: number }
interface Waiter { assetId: string; resolve: (entry: AccessEntry) => void; reject: (error: unknown) => void }
interface Bucket { client: SuiteClient; projectId: string; variant: SuiteImageVariant; waiters: Waiter[] }

const cache = new Map<string, AccessEntry>()
const inflight = new Map<string, Promise<AccessEntry>>()
const buckets = new Map<string, Bucket>()

const cacheKey = (projectId: string, assetId: string, variant: SuiteImageVariant) => `${projectId}:${assetId}:${variant}`
const fresh = (entry: AccessEntry) => entry.expiresAt - Date.now() > SUITE_IMAGE_REFRESH_MARGIN_MS

export function clearSuiteImageAccess() {
  cache.clear()
  inflight.clear()
  for (const bucket of buckets.values()) for (const waiter of bucket.waiters) waiter.reject(new Error('图片授权已失效'))
  buckets.clear()
}

useUserStore.subscribe((state, previous) => {
  if (state.userId !== previous.userId || state.account?.runtimeScope !== previous.account?.runtimeScope) clearSuiteImageAccess()
})

async function flush(bucketKey: string) {
  const bucket = buckets.get(bucketKey)
  if (!bucket) return
  buckets.delete(bucketKey)
  const waiters = bucket.waiters
  const ids = [...new Set(waiters.map(waiter => waiter.assetId))]
  try {
    const result = await bucket.client.access(bucket.projectId, ids, bucket.variant)
    for (const waiter of waiters) {
      const item = result.items.find(entry => entry.assetId === waiter.assetId)
      if (!item) { waiter.reject(new Error('图片不可用')); continue }
      const served = item.served ?? bucket.variant
      const expiresAt = bucket.variant === 'thumbnail' && served !== 'thumbnail'
        ? Math.min(item.expiresAt, Date.now() + THUMBNAIL_FALLBACK_TTL_MS) : item.expiresAt
      const entry = { url: item.url, expiresAt }
      cache.set(cacheKey(bucket.projectId, waiter.assetId, bucket.variant), entry)
      waiter.resolve(entry)
    }
  } catch (error) {
    if (bucket.variant === 'thumbnail' && error instanceof CloudError && error.status === 400) {
      try {
        const result = await bucket.client.access(bucket.projectId, ids, 'original')
        for (const waiter of waiters) {
          const item = result.items.find(entry => entry.assetId === waiter.assetId)
          if (!item) { waiter.reject(new Error('图片不可用')); continue }
          const entry = { url: item.url, expiresAt: Math.min(item.expiresAt, Date.now() + THUMBNAIL_FALLBACK_TTL_MS) }
          cache.set(cacheKey(bucket.projectId, waiter.assetId, bucket.variant), entry)
          waiter.resolve(entry)
        }
        return
      } catch (fallback) {
        for (const waiter of waiters) waiter.reject(fallback)
        return
      }
    }
    for (const waiter of waiters) waiter.reject(error)
  }
}

function enqueue(client: SuiteClient, projectId: string, assetId: string, variant: SuiteImageVariant) {
  const bucketKey = `${projectId}:${variant}`
  return new Promise<AccessEntry>((resolve, reject) => {
    let bucket = buckets.get(bucketKey)
    if (!bucket) {
      bucket = { client, projectId, variant, waiters: [] }
      buckets.set(bucketKey, bucket)
      queueMicrotask(() => { void flush(bucketKey) })
    }
    bucket.waiters.push({ assetId, resolve, reject })
  })
}

export function loadSuiteImageAccess(client: SuiteClient, projectId: string, assetId: string, variant: SuiteImageVariant) {
  const key = cacheKey(projectId, assetId, variant)
  const cached = cache.get(key)
  if (cached && fresh(cached)) return Promise.resolve(cached)
  const pending = inflight.get(key)
  if (pending) return pending
  const promise = enqueue(client, projectId, assetId, variant).finally(() => { if (inflight.get(key) === promise) inflight.delete(key) })
  inflight.set(key, promise)
  return promise
}

/** 刷新签名时先预载，成功后再替换，避免清空 src 造成闪烁或取消进行中的请求。 */
export function assignSuiteImageSource(img: HTMLImageElement, url: string, onFail: () => void) {
  const current = img.getAttribute('src')
  if (current === url) return () => undefined
  if (!current) { img.src = url; return () => undefined }
  const loader = new Image()
  let cancelled = false
  loader.onload = () => { if (!cancelled) img.src = url }
  loader.onerror = () => { if (!cancelled) onFail() }
  loader.src = url
  return () => { cancelled = true; loader.onload = null; loader.onerror = null }
}
