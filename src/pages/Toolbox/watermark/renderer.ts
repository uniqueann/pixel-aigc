import { drawWatermarkedImage } from './draw'
import type { RenderRequest, RenderResult } from './types'

interface WorkerResponse { id: number; result?: RenderResult; error?: string }

async function readSource(blob: Blob): Promise<(CanvasImageSource & { width: number; height: number }) & { close?: () => void }> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob, { imageOrientation: 'from-image' })
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = () => reject(new Error('无法解码图片'))
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function renderOnMainThread(request: RenderRequest): Promise<RenderResult> {
  const source = await readSource(request.file)
  let logo: Awaited<ReturnType<typeof readSource>> | undefined
  let canvas: HTMLCanvasElement | undefined
  try {
    if (request.settings.kind === 'logo' && request.settings.logo) logo = await readSource(request.settings.logo)
    const scale = request.previewMaxDimension
      ? Math.min(1, request.previewMaxDimension / Math.max(source.width, source.height))
      : 1
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片处理画布')
    drawWatermarkedImage(context, source, source.width, source.height, width, height, request.settings, logo)
    const outputCanvas = canvas
    const blob = await new Promise<Blob>((resolve, reject) => {
      outputCanvas.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), request.sourceMime, 0.92)
    })
    return { blob, mimeType: blob.type, width, height }
  } finally {
    source.close?.()
    logo?.close?.()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

export class WatermarkRenderer {
  private worker: Worker | null = null
  private nextId = 0
  private pending = new Map<number, { resolve: (value: RenderResult) => void; reject: (reason: Error) => void }>()
  private disposed = false

  constructor() {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || !OffscreenCanvas.prototype.convertToBlob) return
    try {
      this.worker = new Worker(new URL('./watermark.worker.ts', import.meta.url), { type: 'module' })
      this.worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const pending = this.pending.get(event.data.id)
        if (!pending) return
        this.pending.delete(event.data.id)
        if (event.data.result) pending.resolve(event.data.result)
        else pending.reject(new Error(event.data.error || '图片处理失败'))
      }
      this.worker.onerror = () => {
        this.worker?.terminate()
        this.worker = null
        for (const pending of this.pending.values()) pending.reject(new Error('后台画布不可用'))
        this.pending.clear()
      }
    } catch {
      this.worker = null
    }
  }

  async render(request: RenderRequest): Promise<RenderResult> {
    if (this.disposed) throw new Error('处理已取消')
    if (!this.worker) return renderOnMainThread(request)
    return new Promise<RenderResult>((resolve, reject) => {
      const id = ++this.nextId
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, request })
    }).catch(error => {
      if (this.disposed || this.worker) throw error
      return renderOnMainThread(request)
    })
  }

  dispose() {
    this.disposed = true
    this.worker?.terminate()
    this.worker = null
    for (const pending of this.pending.values()) pending.reject(new Error('处理已取消'))
    this.pending.clear()
  }
}
