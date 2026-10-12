import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { env } from './config.js'
import { HttpError } from './errors.js'
let client: S3Client | undefined
const s3 = () => client ??= new S3Client({ region: 'auto', requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') } })
const bucket = () => env('R2_BUCKET')

/** 后台传入总预算信号时，每次对象操作另外限制为 30 秒。 */
function objectOperationSignal(signal?: AbortSignal) {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : undefined
}

/** R2 GetObject 对不存在的键抛 NoSuchKey / NotFound，而不是先变成 HttpError。 */
function isMissingObject(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const record = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return record.name === 'NoSuchKey' || record.name === 'NotFound' || record.$metadata?.httpStatusCode === 404
}
export async function signUpload(key: string, mimeType: string, size: number) {
  // 浏览器直传只允许带 Content-Type。x-amz-* 全部放进签名 query，避免触发
  // aigc.contentup.cc 那条只放行 Content-Type 的 CORS 规则。
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: mimeType, ContentLength: size }), { expiresIn: 600, signableHeaders: new Set(['content-type']) })
}
export async function signRead(key: string, expiresIn = 900, disposition?: string) {
  return { url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key,
    ...(disposition ? { ResponseContentDisposition: disposition } : {}) }), { expiresIn }), expiresAt: Date.now() + expiresIn * 1000 }
}

/** 任务详情只核对对象元数据，不下载图片或视频正文。 */
export async function headObject(key: string, signal = AbortSignal.timeout(5000)) {
  try {
    const object = await s3().send(new HeadObjectCommand({ Bucket: bucket(),Key: key }),{ abortSignal: signal })
    return { bytes: object.ContentLength ?? 0,contentType: object.ContentType }
  } catch (error) {
    if (isMissingObject(error)) throw new HttpError(404,'对象不存在','OBJECT_NOT_FOUND')
    throw error
  }
}

export async function deleteObject(key: string, signal?: AbortSignal) {
  const operation = objectOperationSignal(signal)
  operation?.throwIfAborted()
  await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }), operation ? { abortSignal: operation } : undefined)
}

export async function putObject(key: string, bytes: Uint8Array, contentType: string, signal?: AbortSignal) {
  const operation = objectOperationSignal(signal)
  operation?.throwIfAborted()
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: contentType }),
    operation ? { abortSignal: operation } : undefined)
}

export async function getObject(key: string, signal?: AbortSignal) {
  const operation = objectOperationSignal(signal)
  operation?.throwIfAborted()
  const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }),
    operation ? { abortSignal: operation } : undefined).catch(error => {
    if (isMissingObject(error)) throw new HttpError(404, '对象不存在', 'OBJECT_NOT_FOUND')
    throw error
  })
  if (!result.Body) throw new HttpError(404, '对象不存在', 'OBJECT_NOT_FOUND')
  const body = result.Body
  const destroy = () => {
    if ('destroy' in body && typeof body.destroy === 'function') body.destroy(operation?.reason)
  }
  if (operation?.aborted) {
    if ('destroy' in body && typeof body.destroy === 'function') body.destroy()
    operation.throwIfAborted()
  }
  // SDK 收到响应头后可能移除请求的 abort 监听；正文仍须受到预算约束。
  operation?.addEventListener('abort', destroy, { once: true })
  try {
    return { bytes: await body.transformToByteArray(), contentType: result.ContentType }
  } finally {
    operation?.removeEventListener('abort', destroy)
  }
}

export async function getObjectLimited(key: string, maxBytes: number, signal?: AbortSignal) {
  const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: key }),
    signal ? { abortSignal: signal } : undefined).catch(error => {
    if (isMissingObject(error)) {
      throw new HttpError(404, '图片对象已过期或不存在，请重新上传', 'OBJECT_NOT_FOUND')
    }
    throw error
  })
  if (!result.Body) throw new HttpError(404, '对象不存在', 'OBJECT_NOT_FOUND')
  if (result.ContentLength !== undefined && result.ContentLength > maxBytes) {
    if ('destroy' in result.Body && typeof result.Body.destroy === 'function') result.Body.destroy()
    throw new HttpError(413, '图片大小不能超过 20 MB', 'IMAGE_TOO_LARGE')
  }
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new HttpError(413, '图片大小不能超过 20 MB', 'IMAGE_TOO_LARGE')
    chunks.push(bytes)
  }
  return { bytes: Buffer.concat(chunks, size), contentType: result.ContentType }
}
export async function verifyAndPromote(tempKey: string, key: string, expectedSize: number, mimeType: string) {
  const result = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: tempKey }))
  if (result.ContentLength !== expectedSize || expectedSize > 20 * 1024 * 1024 || !result.Body)
    throw new HttpError(400, '上传文件大小不匹配')
  const bytes = await result.Body.transformToByteArray()
  if (bytes.byteLength !== expectedSize) throw new HttpError(400, '上传文件不完整')
  const metadata = await sharp(bytes, { limitInputPixels: 40000000 }).metadata()
  const formats: Record<string, string> = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' }
  if (formats[metadata.format ?? ''] !== mimeType || !metadata.width || !metadata.height || (metadata.pages ?? 1) > 1)
    throw new HttpError(400, '文件实际类型不匹配或图片无效，请使用静态图片')
  // 保存经过核验的同一份字节，避免核验后临时对象被覆盖的竞态。
  await s3().send(new PutObjectCommand({ Bucket: bucket(), Key: key, Body: bytes, ContentType: mimeType }))
  // 临时对象由桶生命周期清理，数据库提交失败时仍可重复核验。
  return { width: metadata.width, height: metadata.height }
}
