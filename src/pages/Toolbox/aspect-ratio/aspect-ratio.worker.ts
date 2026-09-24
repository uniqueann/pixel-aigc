import { drawFittedImage } from './draw'
import { outputMime, outputSize } from './geometry'
import { JPEG_QUALITY, type RenderRequest, type RenderResult } from './types'

interface WorkerRequest { id: number; request: RenderRequest }
interface WorkerResponse { id: number; result?: RenderResult; error?: string }

async function processRequest({ id, request }: WorkerRequest) {
  let source: ImageBitmap | undefined
  let canvas: OffscreenCanvas | undefined
  try {
    if (request.settings.strategy === 'outpaint') throw new Error('智能扩展将在后续版本开放')
    source = await createImageBitmap(request.file, { imageOrientation: 'from-image' })
    const size = outputSize(request.targetWidth, request.targetHeight, request.previewMaxDimension)
    canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('无法创建图片处理画布')
    drawFittedImage(context, source, source.width, source.height, size.width, size.height, request.settings)
    const mimeType = outputMime(request.settings.strategy, request.settings.background)
    const blob = await canvas.convertToBlob({ type: mimeType, quality: JPEG_QUALITY })
    const result: RenderResult = { blob, mimeType: blob.type || mimeType, width: size.width, height: size.height }
    self.postMessage({ id, result } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : '图片处理失败' } satisfies WorkerResponse)
  } finally {
    source?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

let queue: Promise<void> = Promise.resolve()
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => processRequest(event.data))
}
