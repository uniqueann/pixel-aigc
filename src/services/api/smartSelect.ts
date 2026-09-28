import { authEnabled, cloudEnabled, supabase } from '@/cloud/client'
import type { NormBox, NormPoint, SegmentSession } from '@shared/smart-select'
import { fitMattingWorkingSize } from '@shared/smart-select'

export const SMART_SELECT_TIMEOUT_MS = 60_000
export const SMART_SELECT_TIMEOUT_MESSAGE = '智能选区超时，请重试'
export const SMART_SELECT_RETRY_MESSAGE = '智能选区失败，请重试'

export interface SmartSelectRequest {
  imageUrl: string
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

async function displayedJpeg(imageUrl: string, width: number, height: number) {
  const response = await fetch(imageUrl)
  if (!response.ok) throw new Error('读取原图失败')
  const blob = await response.blob()
  const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' })
  const fitted = fitMattingWorkingSize(width, height)
  const canvas = document.createElement('canvas')
  canvas.width = fitted.width
  canvas.height = fitted.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取图片')
  context.drawImage(bitmap, 0, 0, fitted.width, fitted.height)
  bitmap.close?.()
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
  canvas.width = 0
  canvas.height = 0
  if (!jpeg) throw new Error('读取图片失败')
  return jpeg
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

async function postSmartSelect(body: Record<string, unknown>) {
  let response: Response
  try {
    response = await fetch('/api/smart-select', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SMART_SELECT_TIMEOUT_MS),
    })
  } catch (error) {
    throw new SmartSelectRequestError(smartSelectErrorMessage(error))
  }
  const payload = await response.json().catch(() => null) as SmartSelectResponse | null
  if (!response.ok || !payload?.maskBase64 || !payload.width || !payload.height || !payload.bbox) {
    throw new SmartSelectRequestError(
      payload?.error || (response.status === 504 ? SMART_SELECT_TIMEOUT_MESSAGE : SMART_SELECT_RETRY_MESSAGE),
      payload?.code,
      payload?.session,
    )
  }
  return {
    maskDataUrl: `data:image/png;base64,${payload.maskBase64}`,
    width: payload.width,
    height: payload.height,
    bbox: payload.bbox,
    session: payload.session ?? null,
  } satisfies SmartSelectResult
}

export async function requestSmartSelect(input: SmartSelectRequest): Promise<SmartSelectResult> {
  try {
    if (smartSelectUsesMock()) return mockMask(input.naturalSize.width, input.naturalSize.height, input.point)
    const point = input.point
    const box = input.box
    const session = input.session ?? cachedSmartSelectSession(input.imageUrl)
    if (session) {
      try {
        const result = await postSmartSelect({ point, box, session })
        storeSmartSelectSession(input.imageUrl, result.session)
        return result
      } catch (error) {
        if (!(error instanceof SmartSelectRequestError) || error.code !== 'SMART_SELECT_SESSION_INVALID') throw error
      }
    }
    const jpeg = await displayedJpeg(input.imageUrl, input.naturalSize.width, input.naturalSize.height)
    const result = await postSmartSelect({
      mimeType: 'image/jpeg',
      dataBase64: await fileToBase64(jpeg),
      point,
      box,
    })
    storeSmartSelectSession(input.imageUrl, result.session)
    return result
  } catch (error) {
    if (error instanceof SmartSelectRequestError) throw error
    throw new SmartSelectRequestError(smartSelectErrorMessage(error))
  }
}
