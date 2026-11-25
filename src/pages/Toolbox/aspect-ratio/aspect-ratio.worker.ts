import { drawFittedImage } from './draw'
import { outputMime, outputSize } from './geometry'
import { JPEG_QUALITY, type RenderRequest, type RenderResult } from './types'

interface WorkerRequest { id: number; request: RenderRequest }
interface WorkerResponse { id: number; result?: RenderResult; error?: string }

const ERROR_OUTPAINT_UNAVAILABLE = 'OUTPAINT_UNAVAILABLE_WORKER'
const ERROR_CANVAS_CONTEXT = 'CANVAS_CONTEXT_FAILED'
const ERROR_PROCESS_FAILED = 'PROCESS_FAILED'

async function processRequest({ id, request }: WorkerRequest) {
  let source: ImageBitmap | undefined
  let canvas: OffscreenCanvas | undefined
  try {
    if (request.settings.strategy === 'outpaint') throw new Error(ERROR_OUTPAINT_UNAVAILABLE)
    source = await createImageBitmap(request.file, { imageOrientation: 'from-image' })
    const size = outputSize(request.targetWidth, request.targetHeight, request.previewMaxDimension)
    canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error(ERROR_CANVAS_CONTEXT)
    drawFittedImage(context, source, source.width, source.height, size.width, size.height, request.settings)
    const mimeType = request.outputMime ?? outputMime(request.settings.strategy, request.settings.background)
    const blob = await canvas.convertToBlob({ type: mimeType, quality: JPEG_QUALITY })
    const result: RenderResult = { blob, mimeType: blob.type || mimeType, width: size.width, height: size.height }
    self.postMessage({ id, result } satisfies WorkerResponse)
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? (error.message || ERROR_PROCESS_FAILED) : ERROR_PROCESS_FAILED } satisfies WorkerResponse)
  } finally {
    source?.close()
    if (canvas) { canvas.width = 0; canvas.height = 0 }
  }
}

let queue: Promise<void> = Promise.resolve()
self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  queue = queue.then(() => processRequest(event.data))
}
