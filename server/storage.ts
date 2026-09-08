import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import sharp from 'sharp'
import { env } from './config.js'
import { HttpError } from './errors.js'
let client: S3Client | undefined
const s3 = () => client ??= new S3Client({ region: 'auto', requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED', endpoint: `https://${env('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: env('R2_ACCESS_KEY_ID'), secretAccessKey: env('R2_SECRET_ACCESS_KEY') } })
const bucket = () => env('R2_BUCKET')
export async function signUpload(key: string, mimeType: string, size: number) {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: mimeType, ContentLength: size }), { expiresIn: 600, signableHeaders: new Set(['content-type']) })
}
export async function signRead(key: string) {
  return { url: await getSignedUrl(s3(), new GetObjectCommand({ Bucket: bucket(), Key: key }), { expiresIn: 900 }), expiresAt: Date.now() + 900000 }
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
