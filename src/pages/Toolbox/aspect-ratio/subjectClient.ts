import { imageAuthHeader, fileToBase64 } from '@/services/api/image-transfer'
import { checkDetectionSignal, detectionDeadline, measureClientDetection } from '@/services/api/detectionTiming'
import type { DetectionClientTiming } from '@shared/detection'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import { detectionPixelSize, mockDetectSubject } from './subjectFocus'
import type { BatchImage, SubjectBox, SubjectDetection } from './types'

async function loadOriented(file: File, width: number, height: number) {
  try {
    return await createImageBitmap(file, {
      imageOrientation: 'from-image',
      resizeWidth: width,
      resizeHeight: height,
      resizeQuality: 'medium',
    })
  } catch {
    return createImageBitmap(file, { imageOrientation: 'from-image' })
  }
}

async function orientedJpeg(file: File, width: number, height: number, timings: DetectionClientTiming, signal: AbortSignal) {
  const bitmap = await measureClientDetection(timings, 'decode', () => loadOriented(file, width, height))
  const canvas = document.createElement('canvas')
  try {
    checkDetectionSignal(signal)
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取图片')
    const blob = await measureClientDetection(timings, 'encode', async () => {
      context.drawImage(bitmap, 0, 0, width, height)
      return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
    })
    checkDetectionSignal(signal)
    if (!blob) throw new Error('读取图片失败')
    return blob
  } finally { bitmap.close(); canvas.width = 0; canvas.height = 0 }
}

function validBox(box: unknown): box is SubjectBox | null {
  if (box === null) return true
  if (!box || typeof box !== 'object') return false
  const value = box as SubjectBox
  return [value.x, value.y, value.width, value.height].every(n => Number.isFinite(n) && n >= 0 && n <= 1)
    && value.width > 0 && value.height > 0 && value.x + value.width <= 1.000001 && value.y + value.height <= 1.000001
}

export async function detectImageSubject(image: Pick<BatchImage, 'file' | 'width' | 'height'>, options: { signal?: AbortSignal } = {}): Promise<SubjectDetection> {
  checkDetectionSignal(options.signal)
  if (liveCapabilityReady(Capability.BgRemove)) return mockDetectSubject()
  const timings: DetectionClientTiming = {}
  const started = performance.now()
  const metric: Record<string, string | number> = { source: 'network', requestCount: 0, requestBytes: 0, outcome: 'failed' }
  const deadline = detectionDeadline(options.signal, 55_000)
  try {
    const size = detectionPixelSize(image.width, image.height)
    const jpeg = await orientedJpeg(image.file, size.width, size.height, timings, deadline.signal)
    const dataBase64 = await measureClientDetection(timings, 'base64', () => fileToBase64(jpeg))
    checkDetectionSignal(deadline.signal)
    const headers = await imageAuthHeader()
    checkDetectionSignal(deadline.signal)
    const body = JSON.stringify({ mimeType: 'image/jpeg', dataBase64, width: size.width, height: size.height, clientTimingMs: timings })
    metric.requestBytes = new TextEncoder().encode(body).byteLength
    metric.requestCount = 1
    const response = await fetch('/api/subject-detect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers }, body, signal: deadline.signal,
    })
    metric.status = response.status
    const readStarted = performance.now()
    let payload: { box?: SubjectBox | null; error?: string; requestId?: string } | null
    try { payload = await response.json() }
    finally { metric.responseReadMs = Math.round(performance.now() - readStarted) }
    if (payload?.requestId) metric.requestId = payload.requestId
    checkDetectionSignal(deadline.signal)
    if (!response.ok) {
      throw new Error(payload?.error || '主体检测失败')
    }
    if (!payload || !validBox(payload.box)) throw new Error('主体检测返回了无效结果')
    metric.outcome = 'success'
    return { box: payload.box }
  } catch (error) {
    metric.outcome = options.signal?.aborted ? 'cancelled' : deadline.signal.aborted ? 'timeout' : 'failed'
    if (deadline.signal.aborted) throw deadline.signal.reason
    throw error
  } finally {
    deadline.dispose()
    console.debug('[主体检测]', { ...metric, clientTimingMs: timings, elapsedMs: Math.round(performance.now() - started) })
  }
}
