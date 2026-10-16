import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { IMAGE_BENCHMARK_BYTES, imageBenchmarkRequest, type ImageBenchmarkRequest, type ImageBenchmarkResult } from '../../shared/image-benchmark.js'
import { HttpError } from '../errors.js'

export interface BenchmarkRuntime {
  now(): number
  database(signal: AbortSignal): Promise<Record<string, number>>
  put(key: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>
  get(key: string, signal: AbortSignal): Promise<Uint8Array>
  remove(key: string, signal: AbortSignal): Promise<void>
  connect(provider: 'qwen' | 'tencent', signal: AbortSignal): Promise<Record<string, number> | null>
}

const instance = randomUUID()
let instanceRequests = 0

export function authorizeImageBenchmark(authorization: string | undefined, env: NodeJS.ProcessEnv = process.env, now = Date.now()) {
  const expires = Number(env.IMAGE_BENCHMARK_EXPIRES_AT)
  if (env.VERCEL_ENV !== 'preview' || env.AIGC_RUNTIME_SCOPE !== 'preview' || env.IMAGE_BENCHMARK_ENABLED !== 'true'
    || !Number.isFinite(expires) || expires <= now || expires > now + 24 * 60 * 60 * 1000)
    throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  const expected = env.IMAGE_BENCHMARK_TOKEN ?? ''
  const supplied = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  if (expected.length < 32 || Buffer.byteLength(supplied) !== Buffer.byteLength(expected)
    || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) throw new HttpError(401, '未授权', 'AUTH_REQUIRED')
  if (!/^[a-f0-9]{40}$/.test(env.IMAGE_BENCHMARK_REVISION ?? '')
    || !/^[0-9a-f-]{36}$/i.test(env.IMAGE_BENCHMARK_USER_ID ?? '')) throw new HttpError(503, '基准配置不完整', 'BENCHMARK_CONFIG')
}

/** 用本轮私钥生成配置指纹，只比较配置一致性，不输出连接串、凭证或桶名。 */
export function benchmarkConfiguration(env: NodeJS.ProcessEnv) {
  const keys = ['AIGC_DATABASE_URL', 'R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY',
    'TENCENT_COS_BUCKET', 'TENCENT_COS_REGION', 'QWEN_IMAGE_BASE_URL', 'DASHSCOPE_BASE_URL',
    'QWEN_IMAGE_POLL_INTERVAL_MS', 'QWEN_IMAGE_STATUS_TIMEOUT_MS', 'IMAGE_BENCHMARK_USER_ID', 'AIGC_RUNTIME_SCOPE']
  return createHmac('sha256', env.IMAGE_BENCHMARK_TOKEN!).update(JSON.stringify(keys.map(key => env[key] ?? null))).digest('hex')
}

const safeCode = (error: unknown) => {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,55}$/.test(code) ? code : 'PROBE_FAILED'
}

export async function runImageBenchmark(body: unknown, runtime: BenchmarkRuntime, env: NodeJS.ProcessEnv = process.env): Promise<ImageBenchmarkResult> {
  const request: ImageBenchmarkRequest = imageBenchmarkRequest.parse(body)
  const result: ImageBenchmarkResult = { ...request, version: 1, environment: 'preview', region: env.VERCEL_REGION ?? 'unknown',
    revision: env.IMAGE_BENCHMARK_REVISION!, deployment: env.VERCEL_URL ?? 'local', configuration: benchmarkConfiguration(env),
    instance, instanceRequest: ++instanceRequests, node: process.version,
    memoryMb: Number(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE) || null, outcome: 'success', phases: {}, bytes: 0, cleanup: 'not_needed' }
  const started = runtime.now()
  const measure = async <T>(name: string, action: () => Promise<T>) => {
    const at = runtime.now()
    try { return await action() } finally { result.phases[name] = Math.max(0, runtime.now() - at) }
  }
  const signal = AbortSignal.timeout(45_000)
  let objectKey: string | undefined
  try {
    if (request.case === 'database') Object.assign(result.phases, await measure('database', () => runtime.database(signal)))
    else if (request.case === 'storage-small' || request.case === 'storage-large') {
      const bytes = Buffer.alloc(IMAGE_BENCHMARK_BYTES[request.case], 0x5a)
      objectKey = `temporary/image-benchmark/${env.IMAGE_BENCHMARK_USER_ID}/preview/${request.runId}/${env.VERCEL_REGION}/${randomUUID()}.bin`
      // 先记下本轮键；PUT 即使响应丢失也只清理这一个测试对象。
      await measure('put', () => runtime.put(objectKey!, bytes, signal))
      const downloaded = await measure('get', () => runtime.get(objectKey!, signal))
      result.bytes = bytes.length + downloaded.length
      if (downloaded.length !== bytes.length || createHash('sha256').update(downloaded).digest('hex') !== createHash('sha256').update(bytes).digest('hex'))
        throw new HttpError(502, '基准对象校验失败', 'CHECKSUM_MISMATCH')
    } else if (request.case === 'qwen-connect' || request.case === 'tencent-connect') {
      const phases = await runtime.connect(request.case === 'qwen-connect' ? 'qwen' : 'tencent', signal)
      if (phases) Object.assign(result.phases, phases)
      else { result.outcome = 'skipped'; result.errorCode = 'PROVIDER_NOT_CONFIGURED' }
    }
  } catch (error) {
    result.outcome = 'failed'
    result.errorCode = signal.aborted ? 'PROBE_TIMEOUT' : safeCode(error)
  } finally {
    if (objectKey) {
      try { await measure('cleanup', () => runtime.remove(objectKey!, AbortSignal.timeout(5_000))); result.cleanup = 'success' }
      catch { result.cleanup = 'failed'; result.outcome = 'failed'; result.errorCode ??= 'CLEANUP_FAILED' }
    }
    result.phases.total = Math.max(0, runtime.now() - started)
  }
  return result
}
