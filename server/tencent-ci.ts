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
  putObject(params: Record<string, unknown>, callback: (error: Error | null) => void): void
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

function call<T>(run: (done: (error: Error | null, value: T) => void) => void) {
  return new Promise<T>((resolve, reject) => {
    run((error, value) => error ? reject(error) : resolve(value))
  })
}

export async function goodsMatting(image: Buffer, config = tencentCiConfig()) {
  if (!config) throw new HttpError(503, '智能抠图即将上线，腾讯云配置还没填好', 'BG_REMOVE_UNCONFIGURED')
  const cos = clientFor(config)
  const sourceKey = `bg-remove/${randomUUID()}`
  const outputKey = `${sourceKey}.png`
  const bucket = { Bucket: config.bucket, Region: config.region }
  try {
    await call<void>(done => cos.putObject({
      ...bucket,
      Key: sourceKey,
      Body: image,
      Headers: {
        'Pic-Operations': JSON.stringify({
          is_pic_info: 1,
          rules: [{ fileid: outputKey, rule: 'ci-process=GoodsMatting' }],
        }),
      },
    }, error => done(error, undefined)))
    const saved = await call<{ Body?: Buffer }>(done => cos.getObject({ ...bucket, Key: outputKey }, done))
    if (!saved.Body?.length) throw new HttpError(502, '腾讯云没有返回抠图结果', 'BG_REMOVE_EMPTY')
    return saved.Body
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(502, '腾讯云商品抠图失败', 'BG_REMOVE_FAILED')
  } finally {
    await Promise.all([sourceKey, outputKey].map(key => call<void>(done => cos.deleteObject({ ...bucket, Key: key }, error => done(error, undefined))).catch(() => undefined)))
  }
}
