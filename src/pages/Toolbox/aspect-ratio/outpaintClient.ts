import { computeOutpaintMask } from '@/pages/ImageWorkstation/utils/maskExport'
import { uploadDataUrl, uploadImage } from '@/services/api/upload'
import { createTask, getTask } from '@/services/api/task'
import { Capability, type OutpaintTaskParams } from '@/types'
import type { ExpansionPlan } from './expansion'
import type { BatchImage, RenderResult } from './types'

const ACTIVE = new Set(['pending', 'queued', 'processing'])

async function canvasBlob(canvas: HTMLCanvasElement, type: string) {
  const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, 0.92))
  if (!blob) throw new Error('图片编码失败')
  return blob
}

export async function renderScaledSource(file: File, width: number, height: number) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('无法创建图片处理画布')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, bitmap.width, bitmap.height, 0, 0, width, height)
  bitmap.close()
  const blob = await canvasBlob(canvas, 'image/jpeg')
  canvas.width = 0
  canvas.height = 0
  return new File([blob], 'scaled.jpg', { type: 'image/jpeg' })
}

async function readSize(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return size
}

export async function expandRemoteImage(image: BatchImage, plan: ExpansionPlan, targetWidth: number, targetHeight: number, shouldStop: () => boolean): Promise<RenderResult> {
  const scaled = await renderScaledSource(image.file, plan.sourceSize.width, plan.sourceSize.height)
  const uploaded = await uploadImage(scaled)
  const mask = computeOutpaintMask(
    { width: targetWidth, height: targetHeight },
    plan.originOffset,
    plan.sourceSize,
  )
  const maskUrl = await uploadDataUrl(mask.maskDataUrl)
  const params: OutpaintTaskParams = {
    sourceImageUrl: uploaded.url,
    maskUrl,
    targetSize: { width: targetWidth, height: targetHeight },
    originOffset: plan.originOffset,
  }
  const task = await createTask({ capability: Capability.Outpaint, params, requestId: crypto.randomUUID() })
  let current: Awaited<ReturnType<typeof getTask>> = task
  while (ACTIVE.has(current.status)) {
    if (shouldStop()) throw new Error('处理已取消')
    await new Promise(resolve => setTimeout(resolve, 2000))
    if (shouldStop()) throw new Error('处理已取消')
    current = await getTask(current.id)
  }
  if (current.status !== 'succeeded') throw new Error(current.errorMessage || '扩图失败')
  const url = current.resultUrls?.[0]
  if (!url) throw new Error('扩图没有返回图片')
  const response = await fetch(url)
  if (!response.ok) throw new Error('扩图结果下载失败')
  const blob = await response.blob()
  const size = await readSize(blob)
  return { blob, mimeType: blob.type || 'image/jpeg', width: size.width, height: size.height }
}
