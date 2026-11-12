import { pathToFileURL } from 'node:url'
import { signUpload } from '../server/storage.js'

/** 仅发送无签名 OPTIONS；不上传对象，不返回存储地址或底层错误正文。 */
export async function checkUploadCors(origin: string, uploadUrl: string, request: typeof fetch = fetch) {
  const page = new URL(origin)
  if (!['http:', 'https:'].includes(page.protocol) || page.origin !== origin) {
    throw new Error('请提供完整站点 Origin，不包含路径、查询参数或末尾斜杠')
  }
  const target = new URL(uploadUrl)
  target.search = ''
  target.hash = ''
  try {
    const response = await request(target, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
      redirect: 'error',
      signal: AbortSignal.timeout(10_000),
    })
    const allowedOrigin = response.headers.get('access-control-allow-origin')
    const allowedMethods = response.headers.get('access-control-allow-methods')
    const allowedHeaders = response.headers.get('access-control-allow-headers')
    const methods = allowedMethods?.toUpperCase().split(',').map(value => value.trim()) ?? []
    const headers = allowedHeaders?.toLowerCase().split(',').map(value => value.trim()) ?? []
    return {
      origin, status: response.status, allowedOrigin, allowedMethods, allowedHeaders,
      preflightAllowed: response.ok && (allowedOrigin === origin || allowedOrigin === '*')
        && methods.includes('PUT') && (headers.includes('content-type') || headers.includes('*')),
    }
  } catch {
    // 网络异常可能含完整请求 URL，不能原样输出。
    return { origin, preflightAllowed: false, error: '存储预检请求失败，请核对网络连通性；本结果不能单独证明 CORS 配置有误' }
  }
}

async function main() {
  const required = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']
  const missing = required.filter(name => !process.env[name])
  if (missing.length) {
    console.error(JSON.stringify({ missingVariables: missing }))
    process.exitCode = 1
    return
  }
  const origin = process.argv[2]
  if (!origin) throw new Error('请传入实际页面 Origin，例如 https://aigc.contentup.cc')
  const url = await signUpload('temporary/upload-preflight-check', 'image/png', 4 * 1024 * 1024)
  const result = await checkUploadCors(origin, url)
  console.log(JSON.stringify(result, null, 2))
  if (!result.preflightAllowed) process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error('上传预检诊断未完成，请核对站点 Origin 和 R2 运行配置；未输出底层错误以避免泄漏签名信息')
    process.exitCode = 1
  })
}
