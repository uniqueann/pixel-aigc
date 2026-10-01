import { HttpError } from './errors.js'
import { putObject, signRead } from './storage.js'

export const PROVIDER_URL_THRESHOLD_BYTES = 1_000_000
export const PROVIDER_URL_EXPIRES_SECONDS = 3_600
export const PROVIDER_URL_SUBMIT_TIMEOUT_MS = 35_000

export function shouldUseProviderUrls(bytes: number, mode?: string) {
  return mode === 'url' || (mode !== 'inline' && bytes >= PROVIDER_URL_THRESHOLD_BYTES)
}

export async function stageProviderInputs(
  route: 'erase' | 'repaint' | 'outpaint',
  requestId: string,
  image: Buffer,
  mask?: Buffer,
  pass?: number,
  signal?: AbortSignal,
) {
  const prefix = `temporary/dashscope-inputs/${route}/${requestId}${pass ? `/${pass}` : ''}`
  const imageKey = `${prefix}/source.jpg`
  const maskKey = `${prefix}/mask.png`
  const upload = (key: string, bytes: Buffer, contentType: string) => signal
    ? putObject(key, bytes, contentType, signal)
    : putObject(key, bytes, contentType)
  try {
    await Promise.all([
      upload(imageKey, image, 'image/jpeg'),
      ...(mask ? [upload(maskKey, mask, 'image/png')] : []),
    ])
    const [source, painted] = await Promise.all([
      signRead(imageKey, PROVIDER_URL_EXPIRES_SECONDS),
      ...(mask ? [signRead(maskKey, PROVIDER_URL_EXPIRES_SECONDS)] : []),
    ])
    return { baseImageUrl: source.url, maskImageUrl: painted?.url }
  } catch (error) {
    if (signal?.aborted) throw new HttpError(504, '临时图片上传超时，请重试', 'PROVIDER_INPUT_TIMEOUT', { cause: error, stage: 'providerInputUpload' })
    throw new HttpError(502, '临时图片上传失败，请稍后重试', 'PROVIDER_INPUT_FAILED', { cause: error, stage: 'providerInputUpload' })
  }
}
