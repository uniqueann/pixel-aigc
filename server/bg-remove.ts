import { prepareMattingImage, restoreMattingImage, assertMattingDeadline } from './bg-remove-image.js'
import { HttpError } from './errors.js'
import { putObject, signRead } from './storage.js'
import { mattingFromUrl } from './tencent-matting.js'

export async function removeBackground(image: Buffer, options: {
  userId: string
  requestId: string
  sourceImageKey?: string
  deadlineAt: number
  log: (entry: Record<string, unknown>) => void
}) {
  const started = Date.now()
  const prepared = await prepareMattingImage(image, { deadlineAt: options.deadlineAt })
  options.log({ stage: 'inputPrepare', ms: Date.now() - started, width: prepared.width, height: prepared.height,
    workWidth: prepared.workWidth, workHeight: prepared.workHeight, inputBytes: image.length,
    providerInputBytes: prepared.bytes.length, inputTransport: 'url', providerMime: prepared.mimeType,
    orientationPolicy: 'upright', contentWidth: prepared.contentWidth, contentHeight: prepared.contentHeight,
    scaleX: prepared.contentWidth / prepared.width, scaleY: prepared.contentHeight / prepared.height,
    reusableSource: prepared.reusableSource })
  let sourceKey = prepared.reusableSource ? options.sourceImageKey : undefined
  if (!sourceKey) {
    sourceKey = `temporary/tencent-inputs/bg-remove/${options.userId}/${options.requestId}.${prepared.mimeType === 'image/png' ? 'png' : 'jpg'}`
    const writeStarted = Date.now()
    assertMattingDeadline(options.deadlineAt, 'providerInputWrite')
    const signal = AbortSignal.timeout(Math.max(1, options.deadlineAt - Date.now()))
    try { await putObject(sourceKey, prepared.bytes, prepared.mimeType, signal) }
    catch {
      throw new HttpError(signal.aborted ? 504 : 502, '抠图识别副本保存失败，请重试', 'BG_REMOVE_INPUT_WRITE_FAILED', { stage: 'providerInputWrite' })
    } finally { options.log({ stage: 'providerInputWrite', ms: Date.now() - writeStarted }) }
  }
  const signed = await signRead(sourceKey, 3600)
  const png = await mattingFromUrl(signed.url, { deadlineAt: options.deadlineAt, log: options.log })
  const restoreStarted = Date.now()
  try { return await restoreMattingImage(png, prepared, options.deadlineAt) }
  finally { options.log({ stage: 'restoreAlpha', ms: Date.now() - restoreStarted }) }
}
