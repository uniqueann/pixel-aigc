import { i18n } from '@/i18n'
import { authorizeSyncQuote } from './billing'
import { postBilledSyncImage } from './billed-sync'
import type { ImageResultReadOptions } from './image-transfer'
import { normalizeImageBlob } from '@shared/image-format'
import {
  clientTiming, fileToBase64, imageMimeType, MAX_IMAGE_BYTES,
  pngMaskBlob, readImageResult, shouldUseInlineImageTransport,
} from './image-transfer'
import { uploadTaskInput } from './upload'

export function shouldUseInlineEraseTransport(imageBytes: number, maskBytes: number, prompt: string, sourceObjectKey?: string) {
  return shouldUseInlineImageTransport(imageBytes, maskBytes, prompt, sourceObjectKey)
}

/** 小图沿用原路径，大图通过私有对象存储传输。 */
export async function requestErase(
  image: Blob | null,
  mimeType: string,
  mask: Blob | string,
  prompt = '',
  sourceObjectKey?: string,
  resultOptions: ImageResultReadOptions = {},
) {
  const prepareStarted = performance.now()
  const painted = pngMaskBlob(mask, i18n.t('errors:client.eraseEmptyMask'), i18n.t('errors:client.eraseInvalidMask'))
  if (!painted.size || painted.size > MAX_IMAGE_BYTES) throw new Error(i18n.t('errors:client.eraseMaskTooLarge'))
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error(i18n.t('errors:generic.singleImageTooLarge'))
  const quote = await authorizeSyncQuote('erase', 5)
  if (image && !sourceObjectKey) image = await normalizeImageBlob(image)
  const inline = image && shouldUseInlineEraseTransport(image.size, painted.size, prompt, sourceObjectKey)
  let body: Record<string, unknown>
  let uploadMs = 0
  if (inline && image) {
    const [dataBase64, maskBase64] = await Promise.all([fileToBase64(image), fileToBase64(painted)])
    body = { mimeType: imageMimeType(image, mimeType), dataBase64, maskMimeType: 'image/png', maskBase64, prompt }
  } else {
    const uploadStarted = performance.now()
    const signal = AbortSignal.timeout(120_000)
    const [sourceImageKey, maskImageKey] = await Promise.all([
      sourceObjectKey ? Promise.resolve(sourceObjectKey) : uploadTaskInput(image!, imageMimeType(image!, mimeType), signal),
      uploadTaskInput(painted, 'image/png', signal),
    ])
    uploadMs = Math.round(performance.now() - uploadStarted)
    body = { sourceImageKey, maskImageKey, prompt }
  }
  body.clientTimingMs = clientTiming(prepareStarted, uploadMs)
  resultOptions.onTaskIdentity?.(quote.requestId)
  const response = await postBilledSyncImage('erase', body, quote,resultOptions.signal)
  return readImageResult(response, i18n.t('credits:syncTools.erase'), resultOptions)
}
