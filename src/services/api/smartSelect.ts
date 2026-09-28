import { authEnabled, cloudEnabled, supabase } from '@/cloud/client'
import type { NormBox, NormPoint, SegmentSession } from '@shared/smart-select'

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
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取图片')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close?.()
  const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
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

async function postSmartSelect(body: Record<string, unknown>) {
  const response = await fetch('/api/smart-select', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const payload = await response.json().catch(() => null) as SmartSelectResponse | null
  if (!response.ok || !payload?.maskBase64 || !payload.width || !payload.height || !payload.bbox) {
    throw new SmartSelectRequestError(payload?.error || '智能选区失败', payload?.code, payload?.session)
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
  if (smartSelectUsesMock()) return mockMask(input.naturalSize.width, input.naturalSize.height, input.point)
  const point = input.point
  const box = input.box
  if (input.session) {
    try {
      return await postSmartSelect({ point, box, session: input.session })
    } catch (error) {
      if (!(error instanceof SmartSelectRequestError) || error.code !== 'SMART_SELECT_SESSION_INVALID') throw error
    }
  }
  const jpeg = await displayedJpeg(input.imageUrl, input.naturalSize.width, input.naturalSize.height)
  return postSmartSelect({
    mimeType: 'image/jpeg',
    dataBase64: await fileToBase64(jpeg),
    point,
    box,
  })
}
