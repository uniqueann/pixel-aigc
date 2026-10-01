import { createRequire } from 'node:module'
import { Agent, fetch as undiciFetch } from 'undici'
import { HttpError } from './errors.js'
import { tencentCiConfig, type TencentCiConfig } from './tencent-ci.js'
import { BG_REMOVE_MAX_RESULT_BYTES } from './bg-remove-image.js'

const require = createRequire(import.meta.url)
const dispatcher = new Agent({ connectTimeout: 10_000, headersTimeout: 70_000, bodyTimeout: 70_000 })
type MattingLog = (entry: Record<string, unknown>) => void

/** 根路径 GET 读取第三方图片；SDK 的对象下载辅助函数不支持空对象键。 */
export function signedMattingRequest(sourceUrl: string, config: TencentCiConfig) {
  if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(config.bucket) || !/^[a-z0-9-]+$/.test(config.region)) {
    throw new HttpError(503, '腾讯云存储桶配置无效', 'BG_REMOVE_UNCONFIGURED')
  }
  const host = `${config.bucket}.cos.${config.region}.myqcloud.com`
  const query = { 'ci-process': 'GoodsMatting', 'center-layout': '0', 'detect-url': sourceUrl }
  const COS = require('cos-nodejs-sdk-v5') as { getAuthorization(params: Record<string, unknown>): string }
  const authorization = COS.getAuthorization({ SecretId: config.secretId, SecretKey: config.secretKey,
    Method: 'GET', Key: '/', Headers: { host }, Query: query, Expires: 300 })
  const url = new URL(`https://${host}/`)
  url.search = new URLSearchParams(query).toString()
  return { url: url.toString(), headers: { Authorization: authorization } }
}

export async function mattingFromUrl(sourceUrl: string, options: {
  deadlineAt: number
  log?: MattingLog
  config?: TencentCiConfig | null
  fetch?: typeof globalThis.fetch
}) {
  const config = options.config === undefined ? tencentCiConfig() : options.config
  if (!config) throw new HttpError(503, '智能抠图尚未配置腾讯云', 'BG_REMOVE_UNCONFIGURED')
  const remaining = Math.min(70_000, options.deadlineAt - Date.now())
  if (remaining <= 0) throw new HttpError(504, '抠图处理超时，请重试', 'BG_REMOVE_TIMEOUT', { stage: 'provider' })
  const signal = AbortSignal.timeout(remaining)
  const request = signedMattingRequest(sourceUrl, config)
  const started = Date.now()
  let stage = 'providerTtfb'
  let stageStarted = started
  try {
    const init = { headers: request.headers, signal, redirect: 'error' as const }
    const response = options.fetch ? await options.fetch(request.url, init)
      : await undiciFetch(request.url, { ...init, dispatcher }) as unknown as Response
    options.log?.({ stage, ms: Date.now() - stageStarted, status: response.status,
      upstreamRequestId: response.headers.get('x-cos-request-id') ?? undefined })
    stage = 'providerDownload'
    stageStarted = Date.now()
    if (!response.ok) {
      await response.body?.cancel()
      throw new HttpError(response.status === 429 ? 429 : 502,
        response.status === 403 ? '腾讯云拒绝了抠图请求，请检查服务权限' : response.status === 429 ? '腾讯抠图请求过于频繁，请稍后重试' : '腾讯抠图服务无法处理图片，请稍后重试',
        'BG_REMOVE_FAILED', { stage: 'provider' })
    }
    const length = Number(response.headers.get('Content-Length'))
    if (response.headers.get('Content-Type')?.split(';')[0].trim() !== 'image/png'
      || length > BG_REMOVE_MAX_RESULT_BYTES || !response.body) {
      await response.body?.cancel()
      throw new HttpError(502, '腾讯没有返回有效的透明 PNG', 'BG_REMOVE_INVALID_RESULT', { stage })
    }
    const reader = response.body.getReader()
    const chunks: Buffer[] = []
    let bytes = 0
    try {
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) break
        bytes += chunk.value.byteLength
        if (bytes > BG_REMOVE_MAX_RESULT_BYTES) {
          throw new HttpError(502, '腾讯抠图结果过大', 'BG_REMOVE_RESULT_TOO_LARGE', { stage })
        }
        chunks.push(Buffer.from(chunk.value))
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally {
      reader.releaseLock()
    }
    if (!bytes) throw new HttpError(502, '腾讯没有返回抠图结果', 'BG_REMOVE_EMPTY', { stage })
    options.log?.({ stage, ms: Date.now() - stageStarted, bytes })
    return Buffer.concat(chunks, bytes)
  } catch (error) {
    options.log?.({ stage, ms: Date.now() - stageStarted, failed: true })
    if (error instanceof HttpError) throw error
    // 不附带原始网络错误，避免嵌套异常泄漏 detect-url 中的存储签名。
    throw new HttpError(signal.aborted ? 504 : 502,
      signal.aborted ? '腾讯抠图超时，请重试' : '无法连接腾讯抠图服务，请稍后重试',
      signal.aborted ? 'BG_REMOVE_TIMEOUT' : 'BG_REMOVE_FAILED', { stage })
  }
}
