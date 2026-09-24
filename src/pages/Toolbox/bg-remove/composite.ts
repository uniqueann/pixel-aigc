import { JPEG_QUALITY } from './types'
import { outputMime } from './prefs'

export interface CompositeResult {
  blob: Blob
  mimeType: string
  width: number
  height: number
}

async function loadImage(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  return bitmap
}

function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), type, JPEG_QUALITY)
  })
}

export async function compositeMatte(matte: Blob, background: string, previewMaxDimension?: number): Promise<CompositeResult> {
  const source = await loadImage(matte)
  try {
    const scale = previewMaxDimension
      ? Math.min(1, previewMaxDimension / Math.max(source.width, source.height))
      : 1
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片处理画布')
    if (background !== 'transparent') {
      context.fillStyle = background
      context.fillRect(0, 0, width, height)
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)
    const mimeType = outputMime(background)
    const blob = await canvasBlob(canvas, mimeType)
    canvas.width = 0
    canvas.height = 0
    return { blob, mimeType: blob.type || mimeType, width, height }
  } finally {
    source.close()
  }
}
