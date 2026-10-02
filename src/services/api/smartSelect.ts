import { authEnabled, cloudEnabled, supabase } from '@/cloud/client'
import { blobFromImageSource } from '@/features/image-workstation/download'
import type { NormBox, NormPoint, SegmentSession } from '@shared/smart-select'
import { fitMattingWorkingSize } from '@shared/smart-select'
import type { DetectionClientTiming } from '@shared/detection'
import { measureClientDetection } from './detectionTiming'

export const SMART_SELECT_TIMEOUT_MS = 60_000
export const SMART_SELECT_TIMEOUT_MESSAGE = '智能选区超时，请重试'
export const SMART_SELECT_RETRY_MESSAGE = '智能选区失败，请重试'

export interface SmartSelectRequest {
  imageUrl: string
  objectKey?: string
  naturalSize: { width: number; height: number }
  point: NormPoint
  box?: NormBox
  session?: SegmentSession | null
}

export interface SmartSelectResult {
  maskDataUrl: string
  width: number
  height: number
  bbox: NormBox
  session: SegmentSession | null
}

interface SmartSelectResponse {
  maskBase64?: string
  width?: number
  height?: number
  bbox?: NormBox
  session?: SegmentSession | null
  error?: string
  code?: string
  requestId?: string
}

const SESSION_CACHE_LIMIT = 8
const sessionCache = new Map<string, SegmentSession>()

export function cachedSmartSelectSession(imageUrl: string) {
  return sessionCache.get(imageUrl) ?? null
}

export function storeSmartSelectSession(imageUrl: string, session: SegmentSession | null | undefined) {
  if (!session) return
  if (sessionCache.has(imageUrl)) sessionCache.delete(imageUrl)
  sessionCache.set(imageUrl, session)
  while (sessionCache.size > SESSION_CACHE_LIMIT) {
    const oldest = sessionCache.keys().next().value
    if (oldest === undefined) break
    sessionCache.delete(oldest)
  }
}

export function clearSmartSelectSessionCache() {
  sessionCache.clear()
}

export function smartSelectUsesMock() {
  return import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled
}

function fileToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

async function displayedJpeg(imageUrl: string, width: number, height: number, objectKey: string | undefined, timings: DetectionClientTiming) {
  const blob = await measureClientDetection(timings, 'read', () => blobFromImageSource(imageUrl, objectKey))
  const fitted = fitMattingWorkingSize(width, height)
  const bitmap = await measureClientDetection(timings, 'decode', () => createImageBitmap(blob, { imageOrientation: 'from-image' }))
  const canvas = document.createElement('canvas')
  try {
    canvas.width = fitted.width
    canvas.height = fitted.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法读取图片')
    const jpeg = await measureClientDetection(timings, 'encode', async () => {
      context.drawImage(bitmap, 0, 0, fitted.width, fitted.height)
      return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
    })
    if (!jpeg) throw new Error('读取图片失败')
    return jpeg
  } finally { bitmap.close?.(); canvas.width = 0; canvas.height = 0 }
}

function mockMask(width: number, height: number, point: NormPoint): SmartSelectResult {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('当前浏览器不支持智能选区')
  const radius = Math.max(8, Math.min(width, height) * 0.12)
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(point.x * width, point.y * height, radius, 0, Math.PI * 2)
  context.fill()
  return {
    maskDataUrl: canvas.toDataURL('image/png'),
    width,
    height,
    bbox: {
      x: Math.max(0, point.x - radius / width),
      y: Math.max(0, point.y - radius / height),
      width: Math.min(1, (radius * 2) / width),
      height: Math.min(1, (radius * 2) / height),
    },
    session: null,
  }
}

async function authHeader(): Promise<Record<string, string>> {
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export class SmartSelectRequestError extends Error {
  code?: string
  session?: SegmentSession | null
  constructor(message: string, code?: string, session?: SegmentSession | null) {
    super(message)
    this.code = code
    this.session = session
  }
}

export function isSmartSelectTimeout(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const name = 'name' in error ? String(error.name) : ''
  const message = 'message' in error ? String(error.message) : ''
  return name === 'TimeoutError' || name === 'AbortError' || /timed? out|aborted/i.test(message)
}

export function smartSelectErrorMessage(error: unknown) {
  if (isSmartSelectTimeout(error)) return SMART_SELECT_TIMEOUT_MESSAGE
  if (error instanceof SmartSelectRequestError && error.message.trim()) return error.message
  if (error instanceof Error && error.message.trim()) return error.message
  return SMART_SELECT_RETRY_MESSAGE
}

async function postSmartSelect(body: Record<string, unknown>, report: (metric: Record<string, string | number>) => void) {
  const started = performance.now()
  const metric: Record<string, string | number> = { source: body.session ? 'session' : 'image', requestCount: 0, requestBytes: 0, outcome: 'failed' }
  try {
    let response: Response
    try {
      const serialized = JSON.stringify(body)
      const headers = await authHeader()
      metric.requestCount = 1
      metric.requestBytes = new TextEncoder().encode(serialized).byteLength
      response = await fetch('/api/smart-select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: serialized,
        signal: AbortSignal.timeout(SMART_SELECT_TIMEOUT_MS),
      })
    } catch (error) {
      throw new SmartSelectRequestError(smartSelectErrorMessage(error))
    }
    metric.status = response.status
    const readStarted = performance.now()
    const payload = await response.json().catch(error => {
      if (isSmartSelectTimeout(error)) throw new SmartSelectRequestError(SMART_SELECT_TIMEOUT_MESSAGE)
      return null
    }) as SmartSelectResponse | null
    metric.responseReadMs = Math.round(performance.now() - readStarted)
    if (payload?.requestId) metric.requestId = payload.requestId
    if (!response.ok || !payload?.maskBase64 || !payload.width || !payload.height || !payload.bbox) {
      throw new SmartSelectRequestError(
        payload?.error || (response.status === 504 ? SMART_SELECT_TIMEOUT_MESSAGE : SMART_SELECT_RETRY_MESSAGE),
        payload?.code,
        payload?.session,
      )
    }
    metric.outcome = 'success'
    return {
      maskDataUrl: `data:image/png;base64,${payload.maskBase64}`,
      width: payload.width,
      height: payload.height,
      bbox: payload.bbox,
      session: payload.session ?? null,
    } satisfies SmartSelectResult
  } catch (error) {
    if (isSmartSelectTimeout(error) || (error instanceof Error && error.message === SMART_SELECT_TIMEOUT_MESSAGE)) metric.outcome = 'timeout'
    throw error
  } finally {
    metric.elapsedMs = Math.round(performance.now() - started)
    report(metric)
    console.debug('[智能选区]', { operation: 'post', ...metric })
  }
}

export async function requestSmartSelect(input: SmartSelectRequest): Promise<SmartSelectResult> {
  const timings: DetectionClientTiming = {}
  const started = performance.now()
  let requestCount = 0
  let requestBytes = 0
  let outcome = 'failed'
  const post = (body: Record<string, unknown>) => postSmartSelect(body, metric => { requestCount += Number(metric.requestCount); requestBytes += Number(metric.requestBytes) })
  try {
    if (smartSelectUsesMock()) {
      const result = mockMask(input.naturalSize.width, input.naturalSize.height, input.point)
      outcome = 'success'
      return result
    }
    const point = input.point
    const box = input.box
    const session = input.session ?? cachedSmartSelectSession(input.imageUrl)
    if (session) {
      try {
        const result = await post({ point, box, session })
        storeSmartSelectSession(input.imageUrl, result.session)
        outcome = 'success'
        return result
      } catch (error) {
        if (!(error instanceof SmartSelectRequestError) || error.code !== 'SMART_SELECT_SESSION_INVALID') throw error
      }
    }
    const jpeg = await displayedJpeg(input.imageUrl, input.naturalSize.width, input.naturalSize.height, input.objectKey, timings)
    const dataBase64 = await measureClientDetection(timings, 'base64', () => fileToBase64(jpeg))
    const result = await post({
      mimeType: 'image/jpeg',
      dataBase64, clientTimingMs: timings,
      point,
      box,
    })
    storeSmartSelectSession(input.imageUrl, result.session)
    outcome = 'success'
    return result
  } catch (error) {
    if (isSmartSelectTimeout(error) || (error instanceof Error && error.message === SMART_SELECT_TIMEOUT_MESSAGE)) outcome = 'timeout'
    if (error instanceof SmartSelectRequestError) throw error
    throw new SmartSelectRequestError(smartSelectErrorMessage(error))
  } finally {
    console.debug('[智能选区]', { operation: 'complete', outcome, requestCount, requestBytes, clientTimingMs: timings, elapsedMs: Math.round(performance.now() - started) })
  }
}
