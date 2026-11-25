import { i18n } from '@/i18n'
import { authorizeSyncQuote } from './billing'
import { postBilledSyncImage } from './billed-sync'
import type { ImageResultReadOptions } from './image-transfer'
import { normalizeImageBlob } from '@shared/image-format'
import { BAILIAN_IMAGEEDIT_PROMPT_MAX } from '@shared/prompt-limits'
import {
  clientTiming, fileToBase64, imageMimeType, MAX_IMAGE_BYTES,
  pngMaskBlob, readImageResult, shouldUseInlineImageTransport,
} from './image-transfer'
import { uploadTaskInput } from './upload'

/** 原图加同尺寸黑白蒙版，返回未涂抹区域保持原像素的 JPEG。 */
export async function requestRepaint(image: Blob | null, mask: Blob | string, prompt: string, sourceObjectKey?: string, resultOptions: ImageResultReadOptions = {}) {
  const text = prompt.trim().slice(0, BAILIAN_IMAGEEDIT_PROMPT_MAX)
  if (!text) throw new Error(i18n.t('errors:client.repaintEmptyPrompt'))
  const prepareStarted = performance.now()
  const painted = pngMaskBlob(mask, i18n.t('errors:client.repaintEmptyMask'), i18n.t('errors:client.repaintInvalidMask'))
  if (!painted.size || painted.size > MAX_IMAGE_BYTES) throw new Error(i18n.t('errors:client.repaintMaskTooLarge'))
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error(i18n.t('errors:generic.singleImageTooLarge'))
  const quote = await authorizeSyncQuote('repaint', 5)
  if (image && !sourceObjectKey) image = await normalizeImageBlob(image)
  const inline = image && shouldUseInlineImageTransport(image.size, painted.size, text, sourceObjectKey)
  let body: Record<string, unknown>
  let uploadMs = 0
  if (inline && image) {
    const [dataBase64, maskBase64] = await Promise.all([fileToBase64(image), fileToBase64(painted)])
    body = { mimeType: imageMimeType(image), dataBase64, maskBase64, prompt: text }
  } else {
    const uploadStarted = performance.now()
    const signal = AbortSignal.timeout(120_000)
    const [sourceImageKey, maskImageKey] = await Promise.all([
      sourceObjectKey ? Promise.resolve(sourceObjectKey) : uploadTaskInput(image!, imageMimeType(image!), signal),
      uploadTaskInput(painted, 'image/png', signal),
    ])
    uploadMs = Math.round(performance.now() - uploadStarted)
    body = { sourceImageKey, maskImageKey, prompt: text }
  }
  body.clientTimingMs = clientTiming(prepareStarted, uploadMs)
  if (resultOptions.origin) body.origin = resultOptions.origin
  resultOptions.onTaskIdentity?.(quote.requestId)
  const response = await postBilledSyncImage('repaint', body, quote,resultOptions.signal)
  return readImageResult(response, i18n.t('credits:syncTools.repaint'), resultOptions)
}
