import { paddingAround, type PixelPadding } from '../../../shared/outpaint'
import {
  clientTiming, fileToBase64, imageAuthHeader, imageMimeType, MAX_IMAGE_BYTES,
  readImageResult, shouldUseInlineImageTransport,
} from './image-transfer'
import { uploadTaskInput } from './upload'

export { paddingAround }
export type { PixelPadding }

/** 把按留白坐标缩放好的原图交给服务端扩图，返回精确目标尺寸的 JPEG。 */
export async function requestOutpaint(image: Blob | null, mimeType: string, padding: PixelPadding, sourceObjectKey?: string) {
  if (padding.left + padding.right + padding.top + padding.bottom <= 0) throw new Error('没有需要扩展的边缘')
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error('单张图片不能超过 20 MB')
  const prepareStarted = performance.now()
  const inline = image && shouldUseInlineImageTransport(image.size, 0, '', sourceObjectKey)
  let body: Record<string, unknown>
  let uploadMs = 0
  if (inline && image) {
    body = { mimeType: imageMimeType(image, mimeType), dataBase64: await fileToBase64(image), padding }
  } else {
    const uploadStarted = performance.now()
    const sourceImageKey = sourceObjectKey ?? await uploadTaskInput(image!, imageMimeType(image!, mimeType), AbortSignal.timeout(120_000))
    uploadMs = Math.round(performance.now() - uploadStarted)
    body = { sourceImageKey, padding }
  }
  body.clientTimingMs = clientTiming(prepareStarted, uploadMs)
  const response = await fetch('/api/outpaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await imageAuthHeader()) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(115_000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '扩图失败')
  }
  return readImageResult(response, '扩图')
}
