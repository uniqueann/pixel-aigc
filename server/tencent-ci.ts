import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { HttpError } from './errors.js'

const require = createRequire(import.meta.url)

export interface TencentCiConfig {
  secretId: string
  secretKey: string
  bucket: string
  region: string
}

interface CosClient {
  putObject(params: Record<string, unknown>, callback: (error: Error | null, data?: UploadAck) => void): void
  getObject(params: Record<string, unknown>, callback: (error: Error | null, data: { Body?: Buffer }) => void): void
  deleteObject(params: Record<string, unknown>, callback: (error: Error | null) => void): void
  request?(params: Record<string, unknown>, callback: (error: Error | null, data?: unknown) => void): void
}

export interface SubjectBox {
  x: number
  y: number
  width: number
  height: number
}

export function tencentCiConfig(env: NodeJS.ProcessEnv = process.env): TencentCiConfig | null {
  const secretId = env.TENCENT_COS_SECRET_ID?.trim()
  const secretKey = env.TENCENT_COS_SECRET_KEY?.trim()
  const bucket = env.TENCENT_COS_BUCKET?.trim()
  const region = env.TENCENT_COS_REGION?.trim()
  if (!secretId || !secretKey || !bucket || !region) return null
  return { secretId, secretKey, bucket, region }
}

function clientFor(config: TencentCiConfig) {
  const COS = require('cos-nodejs-sdk-v5') as new (options: { SecretId: string; SecretKey: string }) => CosClient
  return new COS({ SecretId: config.secretId, SecretKey: config.secretKey })
}

interface UploadAck {
  UploadResult?: {
    ProcessResults?: {
      Object?: { Key?: string } | Array<{ Key?: string }>
    }
  }
}

function call<T>(run: (done: (error: Error | null, value?: T) => void) => void) {
  return new Promise<T | undefined>((resolve, reject) => {
    run((error, value) => error ? reject(error) : resolve(value))
  })
}

export function mattingOperations(outputKey: string) {
  // 不以 / 开头时，数据万象把 fileid 接到原图目录后面。
  // 原图在 bg-remove/<id>，结果会落到 bg-remove/bg-remove/<id>.png，按预期路径读取就是 404。
  return {
    is_pic_info: 1,
    rules: [{ fileid: `/${outputKey.replace(/^\/+/, '')}`, rule: 'ci-process=GoodsMatting&center-layout=0' }],
  }
}

export function processedObjectKey(data: UploadAck | undefined, fallback: string) {
  const object = data?.UploadResult?.ProcessResults?.Object
  const raw = Array.isArray(object) ? object[0]?.Key : object?.Key
  const key = raw?.replace(/^\/+/, '').trim()
  return key || fallback.replace(/^\/+/, '')
}

export function mattingFailure(error: unknown) {
  if (error instanceof HttpError) return error
  const detail = error as { code?: unknown; error?: { Code?: unknown } }
  const code = typeof detail.code === 'string' ? detail.code : typeof detail.error?.Code === 'string' ? detail.error.Code : ''
  const hints: Record<string, string> = {
    NoSuchKey: '没有找到抠图结果',
    ImageTooLarge: '图片尺寸不符合商品抠图要求',
    InvalidImageFormat: '图片格式不受支持',
    AccessDenied: '存储桶拒绝了抠图请求',
  }
  const hint = code ? hints[code] : undefined
  const message = hint ? `腾讯云商品抠图失败：${hint}` : code ? `腾讯云商品抠图失败（${code}）` : '腾讯云商品抠图失败'
  const status = code === 'ImageTooLarge' || code === 'InvalidImageFormat' ? 400 : 502
  return new HttpError(status, message, 'BG_REMOVE_FAILED')
}

function finite(value: unknown) {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(number) ? number : Number.NaN
}

function asList<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return []
  return Array.isArray(value) ? value : [value]
}

function recognitionResult(payload: unknown) {
  if (!payload || typeof payload !== 'object') return null
  const record = payload as { RecognitionResult?: unknown; Body?: { RecognitionResult?: unknown } }
  const result = record.RecognitionResult ?? record.Body?.RecognitionResult
  return result && typeof result === 'object' ? result as { Status?: unknown; DetectMultiObj?: unknown } : null
}

function relativeBox(location: { X?: unknown; Y?: unknown; Width?: unknown; Height?: unknown } | undefined, imageWidth: number, imageHeight: number): SubjectBox | null {
  if (!location || imageWidth <= 0 || imageHeight <= 0) return null
  const x = finite(location.X) / imageWidth
  const y = finite(location.Y) / imageHeight
  const width = finite(location.Width) / imageWidth
  const height = finite(location.Height) / imageHeight
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  if (x < -0.02 || y < -0.02 || x > 1.02 || y > 1.02) return null
  const left = Math.min(Math.max(x, 0), 1)
  const top = Math.min(Math.max(y, 0), 1)
  const right = Math.min(Math.max(x + width, 0), 1)
  const bottom = Math.min(Math.max(y + height, 0), 1)
  if (right - left <= 0 || bottom - top <= 0) return null
  const round = (value: number) => Math.round(value * 1e6) / 1e6
  return { x: round(left), y: round(top), width: round(right - left), height: round(bottom - top) }
}

export function chooseSubjectBox(payload: unknown, imageWidth: number, imageHeight: number): SubjectBox | null {
  const result = recognitionResult(payload)
  if (!result || Number(result.Status) !== 1) return null
  let best: { area: number; distance: number; box: SubjectBox } | null = null
  for (const object of asList(result.DetectMultiObj as { Location?: { X?: unknown; Y?: unknown; Width?: unknown; Height?: unknown } } | undefined)) {
    const box = relativeBox(object?.Location, imageWidth, imageHeight)
    if (!box) continue
    const area = box.width * box.height
    const centerX = box.x + box.width / 2 - 0.5
    const centerY = box.y + box.height / 2 - 0.5
    const distance = centerX * centerX + centerY * centerY
    if (!best || area > best.area + 1e-6 || (Math.abs(area - best.area) <= 1e-6 && distance < best.distance)) best = { area, distance, box }
  }
  return best?.box ?? null
}

export function subjectFailure(error: unknown) {
  if (error instanceof HttpError) return error
  const detail = error as { code?: unknown; error?: { Code?: unknown } }
  const code = typeof detail.code === 'string' ? detail.code : typeof detail.error?.Code === 'string' ? detail.error.Code : ''
  const hints: Record<string, string> = {
    ImageTooLarge: '图片尺寸不符合主体检测要求',
    InvalidImageFormat: '图片格式不受支持',
    AccessDenied: '存储桶拒绝了主体检测请求',
  }
  const hint = code ? hints[code] : undefined
  const message = hint ? `腾讯云主体检测失败：${hint}` : code ? `腾讯云主体检测失败（${code}）` : '腾讯云主体检测失败'
  const status = code === 'ImageTooLarge' || code === 'InvalidImageFormat' ? 400 : 502
  return new HttpError(status, message, 'SUBJECT_DETECT_FAILED')
}

export async function detectGoodsSubject(image: Buffer, width: number, height: number, config = tencentCiConfig(), cos = config ? clientFor(config) : undefined) {
  if (!config || !cos?.request) throw new HttpError(503, '主体检测即将上线，腾讯云配置还没填好', 'SUBJECT_DETECT_UNCONFIGURED')
  const sourceKey = `subject-detect/${randomUUID()}`
  const bucket = { Bucket: config.bucket, Region: config.region }
  try {
    await call<UploadAck>(done => cos.putObject({ ...bucket, Key: sourceKey, Body: image }, done))
    const detected = await call<unknown>(done => cos.request!({
      ...bucket,
      Method: 'GET',
      Key: sourceKey,
      Query: { 'ci-process': 'AIObjectDetect' },
    }, done))
    return chooseSubjectBox(detected, width, height)
  } catch (error) {
    throw subjectFailure(error)
  } finally {
    await call<void>(done => cos.deleteObject({ ...bucket, Key: sourceKey }, error => done(error, undefined))).catch(() => undefined)
  }
}

export async function goodsMatting(image: Buffer, config = tencentCiConfig(), cos = config ? clientFor(config) : undefined) {
  if (!config || !cos) throw new HttpError(503, '智能抠图即将上线，腾讯云配置还没填好', 'BG_REMOVE_UNCONFIGURED')
  const sourceKey = `bg-remove/${randomUUID()}`
  const outputKey = `${sourceKey}.png`
  const bucket = { Bucket: config.bucket, Region: config.region }
  let resultKey = outputKey
  try {
    const uploaded = await call<UploadAck>(done => cos.putObject({
      ...bucket,
      Key: sourceKey,
      Body: image,
      Headers: { 'Pic-Operations': JSON.stringify(mattingOperations(outputKey)) },
    }, done))
    resultKey = processedObjectKey(uploaded, outputKey)
    const saved = await call<{ Body?: Buffer }>(done => cos.getObject({ ...bucket, Key: resultKey }, done))
    if (!saved?.Body?.length) throw new HttpError(502, '腾讯云没有返回抠图结果', 'BG_REMOVE_EMPTY')
    return saved.Body
  } catch (error) {
    throw mattingFailure(error)
  } finally {
    await Promise.all([sourceKey, resultKey].map(key => call<void>(done => cos.deleteObject({ ...bucket, Key: key }, error => done(error, undefined))).catch(() => undefined)))
  }
}
