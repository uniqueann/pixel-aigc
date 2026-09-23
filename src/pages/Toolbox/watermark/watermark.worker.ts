import { drawWatermarkedImage } from './draw'
import type { RenderRequest, RenderResult } from './types'

interface WorkerRequest { id: number; request: RenderRequest }
interface WorkerResponse { id: number; result?: RenderResult; error?: string }

async function processRequest({ id, request }: WorkerRequest) {
  let source: ImageBitmap | undefined
  let logo: ImageBitmap | undefined
  let canvas: OffscreenCanvas | undefined
  try {
    source = await createImageBitmap(request.file, { imageOrientation: 'from-image' })
    if (request.settings.kind === 'logo' && request.settings.logo) logo = await createImageBitmap(request.settings.logo)
    const scale = request.previewMaxDimension
      ? Math.min(1, request.previewMaxDimension / Math.max(source.width, source.height))
      : 1
    const width = Math.max(1, Math.round(source.width * scale))
    const height = Math.max(1, Math.round(source.height * scale))
    canvas = new OffscreenCanvas(width, height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片处理画布')
    drawWatermarkedImage(context, source, source.width, source.height, width, height, request.settings, logo)
    const blob = await canvas.convertToBlob({ type: request.sourceMime, quality: 0.92 })
    const result: RenderResult = { blob, mimeType: blob.type, width, height }
    self.postMessage({ id, result } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '图片处理失败' } satisfies WorkerResponse)
  } finally {
    source?.close()
    logo?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

let queue: Promise<void> = Promise.resolve()
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => processRequest(event.data))
}
