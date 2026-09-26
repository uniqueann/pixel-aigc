import { authEnabled, supabase } from '@/cloud/client'
import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'
import { detectionPixelSize, mockDetectSubject } from './subjectFocus'
import type { BatchImage, SubjectBox, SubjectDetection } from './types'

function fileToBase64(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''))
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.readAsDataURL(blob)
  })
}

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

async function orientedJpeg(file: File, width: number, height: number) {
  const bitmap = await loadOriented(file, width, height)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法读取图片')
  context.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('读取图片失败')
  return blob
}

export async function detectImageSubject(image: Pick<BatchImage, 'file' | 'width' | 'height'>): Promise<SubjectDetection> {
  if (liveCapabilityReady(Capability.BgRemove)) return mockDetectSubject()
  const size = detectionPixelSize(image.width, image.height)
  const jpeg = await orientedJpeg(image.file, size.width, size.height)
  const dataBase64 = await fileToBase64(jpeg)
  const token = authEnabled
    ? (await supabase!.auth.getSession()).data.session?.access_token
    : localStorage.getItem('access_token')
  const response = await fetch('/api/subject-detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ mimeType: 'image/jpeg', dataBase64, width: size.width, height: size.height }),
    signal: AbortSignal.timeout(55000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '主体检测失败')
  }
  const payload = await response.json() as { box?: SubjectBox | null }
  return { box: payload.box ?? null }
}
