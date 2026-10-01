import { normalizeImageBlob } from '@shared/image-format'
import {
  clientTiming, fileToBase64, imageAuthHeader, imageMimeType, MAX_IMAGE_BYTES,
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
) {
  const prepareStarted = performance.now()
  const painted = pngMaskBlob(mask, '请先涂抹要消除的区域', '消除蒙版无效，请重新涂抹')
  if (!painted.size || painted.size > MAX_IMAGE_BYTES) throw new Error('消除蒙版不能超过 20 MB')
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error('单张图片不能超过 20 MB')
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
  const response = await fetch('/api/erase', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await imageAuthHeader()) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(115_000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '消除失败')
  }
  return readImageResult(response, '消除')
}
