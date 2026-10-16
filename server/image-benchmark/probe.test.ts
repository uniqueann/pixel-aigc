import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { authorizeImageBenchmark, runImageBenchmark, type BenchmarkRuntime } from './probe.js'

const env = { VERCEL_ENV: 'preview', AIGC_RUNTIME_SCOPE: 'preview', IMAGE_BENCHMARK_ENABLED: 'true',
  IMAGE_BENCHMARK_EXPIRES_AT: String(Date.now() + 3_600_000), IMAGE_BENCHMARK_TOKEN: 'x'.repeat(48),
  IMAGE_BENCHMARK_REVISION: 'a'.repeat(40), IMAGE_BENCHMARK_USER_ID: randomUUID(), VERCEL_REGION: 'pdx1', VERCEL_URL: 'test.vercel.app' }
afterEach(() => vi.restoreAllMocks())
function fixture() {
  const objects = new Map<string, Uint8Array>()
  const runtime: BenchmarkRuntime = { now: () => performance.now(), database: vi.fn(async () => ({ query: 1 })),
    put: vi.fn(async (key, bytes) => { objects.set(key, bytes) }), get: vi.fn(async key => objects.get(key)!),
    remove: vi.fn(async key => { objects.delete(key) }), connect: vi.fn(async () => ({ dns: 1, tcp: 2, tls: 3 })) }
  const request = { runId: randomUUID(), case: 'storage-small', sample: 1 }
  return { runtime, objects, request }
}
describe('P2-A 预览探测边界', () => {
  it.each([
    { VERCEL_ENV: 'production' }, { AIGC_RUNTIME_SCOPE: 'production' }, { IMAGE_BENCHMARK_ENABLED: 'false' },
    { IMAGE_BENCHMARK_EXPIRES_AT: '0' }, { IMAGE_BENCHMARK_EXPIRES_AT: String(Date.now() + 48 * 3600_000) },
  ])('正式环境、禁用或过期时拒绝，即使令牌正确：%j', patch => {
    expect(() => authorizeImageBenchmark(`Bearer ${env.IMAGE_BENCHMARK_TOKEN}`, { ...env, ...patch })).toThrow('接口不存在')
  })
  it('鉴权通过才可使用固定场景，不能传入 URL、SQL 或对象键', async () => {
    expect(() => authorizeImageBenchmark('Bearer wrong', env)).toThrow('未授权')
    expect(() => authorizeImageBenchmark(`Bearer ${env.IMAGE_BENCHMARK_TOKEN}`, env)).not.toThrow()
    const f = fixture()
    await expect(runImageBenchmark({ ...f.request, url: 'https://private.test', sql: 'delete', objectKey: 'existing' }, f.runtime, env)).rejects.toThrow()
    expect(f.runtime.put).not.toHaveBeenCalled()
  })
  it('只读写本轮随机对象，校验完整字节，返回白名单字段并清理', async () => {
    const f = fixture()
    const result = await runImageBenchmark(f.request, f.runtime, env)
    expect(result).toMatchObject({ outcome: 'success', cleanup: 'success', bytes: 1024 * 1024, region: 'pdx1', revision: env.IMAGE_BENCHMARK_REVISION })
    expect(f.objects.size).toBe(0)
    const key = vi.mocked(f.runtime.put).mock.calls[0][0]
    expect(key).toContain(`/preview/${f.request.runId}/pdx1/`)
    expect(f.runtime.remove).toHaveBeenCalledWith(key, expect.any(AbortSignal))
    expect(JSON.stringify(result)).not.toContain(env.IMAGE_BENCHMARK_USER_ID)
    expect(JSON.stringify(result)).not.toContain(env.IMAGE_BENCHMARK_TOKEN)
    expect(JSON.stringify(result)).not.toContain(key)
  })
  it('PUT 响应失败也清理原测试键，不输出异常中的私有地址', async () => {
    const f = fixture()
    f.runtime.put = vi.fn(async () => { throw new Error('https://secret.test?token=private') })
    const result = await runImageBenchmark(f.request, f.runtime, env)
    expect(result).toMatchObject({ outcome: 'failed', errorCode: 'PROBE_FAILED', cleanup: 'success' })
    expect(JSON.stringify(result)).not.toMatch(/secret|private/)
    expect(f.runtime.get).not.toHaveBeenCalled()
  })
  it('字节不符与清理失败单列为失败，不能算成功样本', async () => {
    const f = fixture()
    f.runtime.get = vi.fn(async () => new Uint8Array([0]))
    expect(await runImageBenchmark(f.request, f.runtime, env)).toMatchObject({ outcome: 'failed', errorCode: 'CHECKSUM_MISMATCH' })
    f.runtime.remove = vi.fn(async () => { throw new Error('存储不可用') })
    expect(await runImageBenchmark(f.request, f.runtime, env)).toMatchObject({ outcome: 'failed', cleanup: 'failed' })
  })
  it('数据库场景不触碰存储，供应商未配置时明确跳过', async () => {
    const f = fixture()
    expect(await runImageBenchmark({ ...f.request, case: 'database' }, f.runtime, env)).toMatchObject({ outcome: 'success', phases: { query: 1 } })
    expect(f.runtime.put).not.toHaveBeenCalled()
    f.runtime.connect = vi.fn(async () => null)
    expect(await runImageBenchmark({ ...f.request, case: 'tencent-connect' }, f.runtime, env)).toMatchObject({ outcome: 'skipped', errorCode: 'PROVIDER_NOT_CONFIGURED' })
  })
})
