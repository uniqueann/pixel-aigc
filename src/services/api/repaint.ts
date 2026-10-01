import {
  clientTiming, fileToBase64, imageAuthHeader, imageMimeType, MAX_IMAGE_BYTES,
  pngMaskBlob, readImageResult, shouldUseInlineImageTransport,
} from './image-transfer'
import { uploadTaskInput } from './upload'

/** 原图加同尺寸黑白蒙版，返回未涂抹区域保持原像素的 JPEG。 */
export async function requestRepaint(image: Blob | null, mask: Blob | string, prompt: string, sourceObjectKey?: string) {
  const text = prompt.trim().slice(0, 800)
  if (!text) throw new Error('请先填写重绘描述')
  const prepareStarted = performance.now()
  const painted = pngMaskBlob(mask, '请先涂抹要重绘的区域', '重绘蒙版无效，请重新涂抹')
  if (!painted.size || painted.size > MAX_IMAGE_BYTES) throw new Error('重绘蒙版不能超过 20 MB')
  if (!sourceObjectKey && (!image?.size || image.size > MAX_IMAGE_BYTES)) throw new Error('单张图片不能超过 20 MB')
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
  const response = await fetch('/api/repaint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await imageAuthHeader()) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(115_000),
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(payload?.error || '重绘失败')
  }
  return readImageResult(response, '重绘')
}
