import { authorizeSyncQuote } from './billing'
import { postBilledSyncImage } from './billed-sync'
import type { ImageResultReadOptions } from './image-transfer'
import { normalizeImageBlob } from '@shared/image-format'
import { outpaintCreditPrice } from '@shared/billing'
import { paddingAround, type PixelPadding } from '../../../shared/outpaint'
import {
  clientTiming, fileToBase64, imageMimeType, MAX_IMAGE_BYTES,
  readImageResult, shouldUseInlineImageTransport,
} from './image-transfer'
import { uploadTaskInput } from './upload'

export { paddingAround }
export type { PixelPadding }

/** 按原图和四边留白提交扩图，返回原图尺寸加留白的 JPEG。 */
export async function requestOutpaint(image: Blob | null, mimeType: string, padding: PixelPadding, sourceObjectKey?: string, resultOptions: ImageResultReadOptions = {}) {
  if (padding.left + padding.right + padding.top + padding.bottom <= 0) throw new Error('没有需要扩展的边缘')
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error('单张图片不能超过 20 MB')
  const prepareStarted = performance.now()
  if (image && !sourceObjectKey) image = await normalizeImageBlob(image)
  let size=resultOptions.sourceSize
  if (!size && image && typeof createImageBitmap === 'function') {
    const bitmap=await createImageBitmap(image)
    size={width:bitmap.width,height:bitmap.height};bitmap.close()
  }
  const quote = await authorizeSyncQuote('outpaint', size ? outpaintCreditPrice(size.width,size.height,padding) : 10)
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
  const response = await postBilledSyncImage('outpaint', body, quote)
  return readImageResult(response, '扩图', resultOptions)
}
