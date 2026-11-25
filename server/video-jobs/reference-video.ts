import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { VIDEO_REFERENCE_MAX_BYTES, VIDEO_REFERENCE_RETENTION_MS, type VideoReference } from '../../shared/video-replication.js'
import type { authenticate } from '../auth.js'
import { runtimeScope, withIdentity } from '../db.js'
import { HttpError } from '../errors.js'
import { requireActive } from '../members.js'
import { readOwnedVideoMetadata } from '../objects.js'
import { getObjectLimited, headObject, putObject, signRead, signUpload } from '../storage.js'
import { probeVideo } from '../video-providers/metadata.js'
import { videoGenerationAvailable } from '../video-providers/registry.js'

type User = Awaited<ReturnType<typeof authenticate>>
const uploadIdPattern = /^\d{13}-[0-9a-f-]{36}$/
const storedRefPattern = /^(\d{13})-[0-9a-f-]{36}-[0-9a-f]{64}\.mp4$/
const sizeSchema = z.number().int().positive().max(VIDEO_REFERENCE_MAX_BYTES)
const prefix = (userId: string) => `temporary/video-replication/${runtimeScope()}/${userId}/`
const invalid = () => new HttpError(400, '请使用 2–15 秒、50 MB 以内的 H.264 MP4 视频', 'VIDEO_REFERENCE_INVALID')

function validateMetadata(value: Pick<VideoReference, 'width' | 'height' | 'durationSeconds'>) {
  if (!Number.isSafeInteger(value.width) || !Number.isSafeInteger(value.height)
    || Math.min(value.width, value.height) < 300 || Math.max(value.width, value.height) > 6000
    || !Number.isFinite(value.durationSeconds) || value.durationSeconds < 2 || value.durationSeconds > 15) {
    throw new HttpError(400, '参考片需为 2–15 秒，画面每边 300–6000 像素', 'VIDEO_REFERENCE_INVALID')
  }
  return value
}

async function readReferenceBytes(key: string) {
  try { return (await getObjectLimited(key, VIDEO_REFERENCE_MAX_BYTES, AbortSignal.timeout(20_000))).bytes }
  catch (error) {
    if (error instanceof HttpError && error.status === 413) throw invalid()
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, '参考视频已过期或不存在，请重新选择', 'VIDEO_REFERENCE_EXPIRED')
    throw error
  }
}

function measure(bytes: Uint8Array) {
  try { return validateMetadata(probeVideo(bytes, { reference: true })) }
  catch (error) { if (error instanceof HttpError) throw error; throw invalid() }
}

async function readVideoObject(key: string) {
  let object: Awaited<ReturnType<typeof headObject>>
  try { object = await headObject(key) }
  catch (error) {
    if (error instanceof HttpError && error.status === 404) throw new HttpError(404, '参考视频已过期或不存在，请重新选择', 'VIDEO_REFERENCE_EXPIRED')
    throw error
  }
  if (object.contentType !== 'video/mp4' || object.bytes < 1 || object.bytes > VIDEO_REFERENCE_MAX_BYTES) throw invalid()
  return object
}

export async function resolveVideoReference(user: User, key: string, ttl = 900): Promise<VideoReference & { url: string }> {
  if (key.startsWith(`generated/${user.id}/video/`) && /\/0\.mp4$/.test(key)) {
    const { videoCodec, retentionExpiresAt, ...dimensions } = await readOwnedVideoMetadata(user, key)
    const remaining = Math.floor((Date.parse(retentionExpiresAt) - Date.now()) / 1000)
    if (remaining <= 0) throw new HttpError(404, '参考视频已过期，请重新选择', 'VIDEO_REFERENCE_EXPIRED')
    if (!/^avc[13]\./.test(videoCodec ?? '')) throw invalid()
    validateMetadata(dimensions)
    await readVideoObject(key)
    const signed = await signRead(key, Math.min(remaining, ttl))
    return { ...dimensions, key, url: signed.url, retentionExpiresAt }
  }
  const match = key.startsWith(prefix(user.id) + 'ready/') && storedRefPattern.exec(key.slice((prefix(user.id) + 'ready/').length))
  if (!match) throw new HttpError(404, '参考视频不存在或无权访问', 'VIDEO_REFERENCE_EXPIRED')
  const expires = Number(match[1]) + VIDEO_REFERENCE_RETENTION_MS
  const remaining = Math.floor((expires - Date.now()) / 1000)
  if (remaining <= 0) throw new HttpError(404, '参考视频已过期，请重新上传', 'VIDEO_REFERENCE_EXPIRED')
  const object = await readVideoObject(key)
  const dimensions = validateMetadata({ width: Number(object.metadata?.width), height: Number(object.metadata?.height),
    durationSeconds: Number(object.metadata?.duration) })
  const signed = await signRead(key, Math.min(remaining, ttl))
  return { ...dimensions, key, url: signed.url, retentionExpiresAt: new Date(expires).toISOString() }
}

export async function handleVideoReferenceRoute(user: User, method: string, path: string[], body: unknown) {
  if (method !== 'POST' || path.length !== 2) throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  if (!videoGenerationAvailable('video_replication')) throw new HttpError(503, '视频复刻暂未开放', 'VIDEO_UNAVAILABLE')
  await withIdentity(user.id, user.email, sql => requireActive(sql, user.id))
  const base = prefix(user.id)
  if (path[1] === 'uploads') {
    const { size } = z.object({ size: sizeSchema }).strict().parse(body)
    const uploadId = `${Date.now()}-${randomUUID()}`
    return { uploadId, uploadUrl: await signUpload(`${base}pending/${uploadId}`, 'video/mp4', size) }
  }
  if (path[1] === 'complete') {
    const { uploadId, size } = z.object({ uploadId: z.string().regex(uploadIdPattern), size: sizeSchema }).strict().parse(body)
    if (Date.now() - Number(uploadId.slice(0, 13)) > 15 * 60_000) throw new HttpError(410, '上传已过期，请重新上传参考片', 'VIDEO_REFERENCE_UPLOAD_EXPIRED')
    const bytes = await readReferenceBytes(`${base}pending/${uploadId}`)
    if (bytes.byteLength !== size) throw invalid()
    const video = measure(bytes)
    const digest = createHash('sha256').update(bytes).digest('hex')
    const key = `${base}ready/${uploadId}-${digest}.mp4`
    // 将校验过的字节写入独立对象，直传签名无法覆盖已经验证的参考片。
    await putObject(key, bytes, 'video/mp4', AbortSignal.timeout(25_000), {
      width: String(video.width), height: String(video.height), duration: String(video.durationSeconds),
    })
    const signed = await signRead(key)
    return { key, width: video.width, height: video.height, durationSeconds: video.durationSeconds, url: signed.url,
      retentionExpiresAt: new Date(Number(uploadId.slice(0, 13)) + VIDEO_REFERENCE_RETENTION_MS).toISOString() }
  }
  if (path[1] === 'inspect') {
    const { key } = z.object({ key: z.string().min(1).max(512) }).strict().parse(body)
    return resolveVideoReference(user, key)
  }
  throw new HttpError(404, '接口不存在', 'NOT_FOUND')
}
