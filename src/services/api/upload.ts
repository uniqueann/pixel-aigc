import { normalizeImageBlob } from '@shared/image-format'
import { filenameWithMimeExtension } from '@/features/image-workstation/download'
import { authEnabled, cloudEnabled } from '@/cloud/client'
import { apiClient } from './client'

const ACCEPTED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const MAX_IMAGE_BYTES = 20 * 1024 * 1024
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
export interface TaskInputUploadMetrics {
  validateMs: number
  signMs: number
  uploadMs: number
  inputBytes: number
  uploadedBytes: number
  outcome: 'success' | 'failed' | 'cancelled'
}
export interface TaskInputUploadOptions {
  onPhase?: (phase: TaskInputUploadPhase) => void
  onMetrics?: (metrics: TaskInputUploadMetrics) => void
}

export async function uploadTaskInput(file: Blob, mimeType = file.type || 'image/jpeg', signal?: AbortSignal, options: TaskInputUploadOptions = {}) {
  const metrics: TaskInputUploadMetrics = { validateMs: 0, signMs: 0, uploadMs: 0, inputBytes: file.size, uploadedBytes: 0, outcome: 'failed' }
  const check = () => { if (signal?.aborted) throw signal.reason ?? new DOMException('上传已取消', 'AbortError') }
  const stage = async <T>(phase: TaskInputUploadPhase, operation: () => Promise<T>) => {
    check()
    options.onPhase?.(phase)
    const started = performance.now()
    try { return await operation() }
    finally { metrics[phase === 'validating' ? 'validateMs' : phase === 'signing' ? 'signMs' : 'uploadMs'] = Math.round(performance.now() - started) }
  }
  try {
    check()
    if (!file.size) throw new Error('图片文件不能为空')
    if (file.size > MAX_IMAGE_BYTES) throw new Error('图片大小不能超过 20 MB')
    file = await stage('validating', () => normalizeImageBlob(file))
    mimeType = file.type
    const signed = await stage('signing', () => apiClient.post<unknown, { uploadUrl: string; objectKey: string }>('/task-inputs', {
      mimeType, size: file.size,
    }, ...(signal ? [{ signal }] : [])))
    check()
    if (!signed.uploadUrl || !signed.objectKey) throw new Error('未获得原图上传地址')
    const uploaded = await stage('uploading', () => fetch(signed.uploadUrl, {
      method: 'PUT', headers: { 'Content-Type': mimeType }, body: file, signal, credentials: 'omit',
    }))
    check()
    if (!uploaded.ok) throw new Error('原图上传失败，请重试')
    metrics.outcome = 'success'
    metrics.uploadedBytes = file.size
    return signed.objectKey
  } catch (error) {
    if (signal?.aborted) { metrics.outcome = 'cancelled'; throw signal.reason ?? new DOMException('上传已取消', 'AbortError') }
    throw error
  } finally { options.onMetrics?.(metrics) }
}

/** 上传图片并返回可注册到 AssetRegistry 的元数据。 */
export async function uploadImage(file: File): Promise<UploadedImage> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片大小不能超过 20 MB')
  const normalized = await normalizeImageBlob(file)
  file = new File([normalized], filenameWithMimeExtension(file.name, normalized.type), { type: normalized.type, lastModified: file.lastModified })
  validateImageFile(file)
  const previewUrl = await readFileAsDataUrl(file)
  const size = await readImageSize(previewUrl)
  if (useMockGateway || authEnabled || cloudEnabled) {
    return { url: previewUrl, name: file.name, mimeType: file.type, ...size }
  }

  const formData = new FormData()
  formData.append('file', file)
  const uploaded = await apiClient.post<unknown, { url: string }>('/uploads', formData)
  if (!uploaded.url) throw new Error('上传接口没有返回图片地址')
  return { url: uploaded.url, name: file.name, mimeType: file.type, ...size }
}

export function validateImageFile(file: Pick<File, 'type' | 'size'>) {
  if (!ACCEPTED_IMAGE_TYPES.has(file.type)) throw new Error('仅支持 PNG、JPEG 和 WebP 图片')
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片大小不能超过 20 MB')
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function readImageSize(url: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('无法解析图片尺寸'))
    image.src = url
  })
}
