import { drawFittedImage } from './draw'
import { outputMime, outputSize } from './geometry'
import { JPEG_QUALITY, type RenderRequest, type RenderResult } from './types'

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
  if (request.settings.strategy === 'outpaint') throw new Error('智能扩展将在后续版本开放')
  const source = await readSource(request.file)
  let canvas: HTMLCanvasElement | undefined
  try {
    const size = outputSize(request.targetWidth, request.targetHeight, request.previewMaxDimension)
    canvas = document.createElement('canvas')
    canvas.width = size.width
    canvas.height = size.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片处理画布')
    drawFittedImage(context, source, source.width, source.height, size.width, size.height, request.settings)
    const mimeType = outputMime(request.settings.strategy, request.settings.background)
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas!.toBlob(value => value ? resolve(value) : reject(new Error('图片编码失败')), mimeType, JPEG_QUALITY)
    })
    return { blob, mimeType: blob.type || mimeType, width: size.width, height: size.height }
  } finally {
    source.close?.()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

export class AspectRatioRenderer {
  private worker: Worker | null = null
  private nextId = 0
  private pending = new Map<number, { resolve: (value: RenderResult) => void; reject: (reason: Error) => void }>()
  private disposed = false

  constructor() {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || !OffscreenCanvas.prototype.convertToBlob) return
    try {
      this.worker = new Worker(new URL('./aspect-ratio.worker.ts', import.meta.url), { type: 'module' })
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
