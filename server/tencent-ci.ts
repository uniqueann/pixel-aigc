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
