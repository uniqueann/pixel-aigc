import { normalizeImageBlob } from '@shared/image-format'
import { base64FitsTaskInputFallback, MAX_IMAGE_BYTES } from '@shared/upload-limits'
import { i18n } from '@/i18n'
import { formatMegabytes } from '@/i18n/format'
import { filenameWithMimeExtension } from '@/features/image-workstation/download'
import { authEnabled, cloudEnabled } from '@/cloud/client'
import { apiClient } from './client'
import { useUserStore } from '@/store/useUserStore'
import { trackFirstUpload, uploadToolForPath } from '@/features/activation/client'
import { fileToBase64 } from './image-transfer'

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const useMockGateway = import.meta.env.VITE_GENERATION_MODE === 'mock'

export interface UploadedImage {
  url: string
  name: string
  mimeType: string
  width: number
  height: number
}

/** 蒙版仍沿用 Data URL；真实对象存储接入后可替换为统一上传。 */
export function uploadDataUrl(dataUrl: string): Promise<string> {
  return Promise.resolve(dataUrl)
}

export type TaskInputUploadPhase = 'validating' | 'signing' | 'uploading'
export interface TaskInputNetworkTiming {
  dnsMs: number
  /** 建连总时间，TLS 是它的子段，不重复相加。 */
  connectMs: number
  tlsMs: number
  /** 包含请求体传输和服务端等待，不能解释为纯上传时间。 */
  requestToResponseMs: number
  responseReadMs: number
}
export interface TaskInputUploadMetrics {
  validateMs: number
  signMs: number
  uploadMs: number
  inputBytes: number
  uploadedBytes: number
  outcome: 'success' | 'failed' | 'cancelled'
  /** 从发起 PUT 至响应头或失败的时间，含连接、传输与服务端等待。 */
  directUploadMs?: number
  directStatus?: number
  directOutcome?: 'success' | 'network-error' | 'http-error' | 'cancelled'
  /** 备用上传未执行时的原因；不能把预算拒绝记为已走备用通道。 */
  fallbackBlockedReason?: 'body-limit'
  fallbackEncodeMs?: number
  fallbackUploadMs?: number
  transport?: 'direct' | 'fallback'
  elapsedMs?: number
  networkTiming?: TaskInputNetworkTiming
}

function uploadNetworkTiming(url: string, started: number): TaskInputNetworkTiming | undefined {
  if (typeof performance.getEntriesByName !== 'function') return undefined
  try {
    const entry = (performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[])
      .filter(value => value.startTime >= started - 1).at(-1)
    // 跨域资源没有 Timing-Allow-Origin，或时序尚未完整可见时，不把零值当作实测。
    if (!entry || !entry.requestStart || !entry.responseStart || !entry.responseEnd) return undefined
    const elapsed = (end: number, start: number) => Math.max(0, Math.round(end - start))
    return {
      dnsMs: elapsed(entry.domainLookupEnd, entry.domainLookupStart),
      connectMs: elapsed(entry.connectEnd, entry.connectStart),
      tlsMs: entry.secureConnectionStart > 0 ? elapsed(entry.connectEnd, entry.secureConnectionStart) : 0,
      requestToResponseMs: elapsed(entry.responseStart, entry.requestStart),
      responseReadMs: elapsed(entry.responseEnd, entry.responseStart),
    }
  } catch { return undefined } // 观测能力异常不能使已经成功的上传失败。
}
export interface TaskInputUploadOptions {
  onPhase?: (phase: TaskInputUploadPhase) => void
  onMetrics?: (metrics: TaskInputUploadMetrics) => void
}

export async function uploadTaskInput(file: Blob, mimeType = file.type || 'image/jpeg', signal?: AbortSignal, options: TaskInputUploadOptions = {}) {
  const started = performance.now()
  const metrics: TaskInputUploadMetrics = { validateMs: 0, signMs: 0, uploadMs: 0, inputBytes: file.size, uploadedBytes: 0, outcome: 'failed' }
  const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException(i18n.t('errors:client.uploadCancelled'), 'AbortError') }
  const stage = async <T>(phase: TaskInputUploadPhase, operation: () => Promise<T>) => {
    check()
    options.onPhase?.(phase)
    const started = performance.now()
    try { return await operation() }
    finally {
      const ms = Math.round(performance.now() - started)
      if (phase === 'uploading') metrics.uploadMs += ms
      else metrics[phase === 'validating' ? 'validateMs' : 'signMs'] = ms
    }
  }
  try {
    check()
    if (!file.size) throw new Error(i18n.t('errors:client.imageEmpty'))
    if (file.size > MAX_IMAGE_BYTES) throw new Error(i18n.t('errors:generic.imageTooLarge', { mb: formatMegabytes(MAX_IMAGE_BYTES) }))
    file = await stage('validating', () => normalizeImageBlob(file))
    mimeType = file.type
    const signed = await stage('signing', () => apiClient.post<unknown, { uploadUrl: string; objectKey: string }>('/task-inputs', {
      mimeType, size: file.size,
    }, ...(signal ? [{ signal }] : [])))
    check()
    if (!signed.uploadUrl || !signed.objectKey) throw new Error(i18n.t('errors:client.missingUploadUrl'))
    let uploaded: Response | undefined
    let directError: unknown
    metrics.transport = 'direct'
    const directStarted = performance.now()
    try {
      uploaded = await stage('uploading', () => fetch(signed.uploadUrl, {
        method: 'PUT', headers: { 'Content-Type': mimeType }, body: file, signal, credentials: 'omit',
      }))
      metrics.directStatus = uploaded.status
      metrics.directOutcome = uploaded.ok ? 'success' : 'http-error'
      check()
    } catch (fetchErr) {
      metrics.directOutcome = signal?.aborted ? 'cancelled' : 'network-error'
      if (signal?.aborted) throw fetchErr
      directError = fetchErr
    } finally {
      metrics.directUploadMs = Math.round(performance.now() - directStarted)
      metrics.networkTiming = uploadNetworkTiming(signed.uploadUrl, directStarted)
    }
    if (uploaded) {
      if (!uploaded.ok) throw new Error(i18n.t('errors:client.sourceUploadFailed'))
    } else {
      // Source image is within limit; fallback JSON upload has a stricter platform payload ceiling.
      if (!base64FitsTaskInputFallback(file.size)) {
        metrics.fallbackBlockedReason = 'body-limit'
        throw Object.assign(new Error(i18n.t('errors:generic.fallbackTooLarge')), { cause: directError })
      }
      metrics.transport = 'fallback'
      const encodeStarted = performance.now()
      let dataBase64: string
      try { dataBase64 = await fileToBase64(file) }
      finally { metrics.fallbackEncodeMs = Math.round(performance.now() - encodeStarted) }
      check()
      const fallbackStarted = performance.now()
      try {
        await stage('uploading', () => apiClient.post('/task-inputs/fallback', {
          objectKey: signed.objectKey, mimeType, dataBase64,
        }, ...(signal ? [{ signal }] : [])))
      } finally { metrics.fallbackUploadMs = Math.round(performance.now() - fallbackStarted) }
    }
    check()
    metrics.outcome = 'success'
    metrics.uploadedBytes = file.size
    return signed.objectKey
  } catch (error) {
    if (signal?.aborted) { metrics.outcome = 'cancelled'; throw signal.reason ?? new DOMException(i18n.t('errors:client.uploadCancelled'), 'AbortError') }
    throw error
  } finally {
    metrics.elapsedMs = Math.round(performance.now() - started)
    options.onMetrics?.(metrics)
  }
}

/** Upload image and return metadata suitable for AssetRegistry. */
export async function uploadImage(file: File, options: { local?: boolean } = {}): Promise<UploadedImage> {
  const owner = useUserStore.getState().userId
  const tool = uploadToolForPath()
  if (file.size > MAX_IMAGE_BYTES) throw new Error(i18n.t('errors:generic.imageTooLarge', { mb: formatMegabytes(MAX_IMAGE_BYTES) }))
  const normalized = await normalizeImageBlob(file)
  file = new File([normalized], filenameWithMimeExtension(file.name, normalized.type), { type: normalized.type, lastModified: file.lastModified })
  validateImageFile(file)
  const previewUrl = await readFileAsDataUrl(file)
  const size = await readImageSize(previewUrl)
  if (options.local || useMockGateway || authEnabled || cloudEnabled) {
    trackFirstUpload(owner, tool)
    return { url: previewUrl, name: file.name, mimeType: file.type, ...size }
  }

  const formData = new FormData()
  formData.append('file', file)
  const uploaded = await apiClient.post<unknown, { url: string }>('/uploads', formData)
  if (!uploaded.url) throw new Error(i18n.t('errors:client.uploadResponseMissingUrl'))
  trackFirstUpload(owner, tool)
  return { url: uploaded.url, name: file.name, mimeType: file.type, ...size }
}

export function validateImageFile(file: Pick<File, 'type' | 'size'>) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error(i18n.t('errors:client.imageTypesOnly'))
  if (file.size > MAX_IMAGE_BYTES) throw new Error(i18n.t('errors:generic.imageTooLarge', { mb: formatMegabytes(MAX_IMAGE_BYTES) }))
}

/**
 * Synchronous validation at selection time before reading file contents,
 * returning an error string immediately (or null when valid).
 */
export function imageFileError(file: Pick<File, 'type' | 'size'>) {
  if (!file.size) return i18n.t('errors:client.imageEmpty')
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) return i18n.t('errors:client.imageTypesOnly')
  if (file.size > MAX_IMAGE_BYTES) return i18n.t('errors:generic.imageTooLarge', { mb: formatMegabytes(MAX_IMAGE_BYTES) })
  return null
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error(i18n.t('errors:client.imageReadFailed')))
    reader.readAsDataURL(file)
  })
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error(i18n.t('errors:client.imageDimensionsFailed')))
    image.src = url
  })
}
