import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { imageBenchmarkManifest, imageBenchmarkPlan, type ImageBenchmarkSample } from '../../shared/image-benchmark.js'
import { renderImageBenchmarkReport, summarizeImageBenchmark, validateBenchmarkSample } from './report.js'
const manifest = imageBenchmarkManifest.parse({ version: 1, runId: randomUUID(), revision: 'a'.repeat(40), rounds: 2,
  cases: ['control', 'storage-small'], targets: [{ region: 'pdx1', url: 'https://test.vercel.app' }] })
const sample = (index = 1, outcome: 'success' | 'failed' = 'success'): ImageBenchmarkSample => ({ requestMs: 100,
  result: { runId: manifest.runId, case: 'storage-small', sample: index, version: 1, environment: 'preview', region: 'pdx1',
    revision: manifest.revision, deployment: 'test.vercel.app', configuration: 'b'.repeat(64), instance: randomUUID(), instanceRequest: 1,
    node: 'v24.0.0', memoryMb: 2048, outcome, phases: { total: index ? 20 : 9999 }, bytes: 1024, cleanup: 'success' } })
describe('P2-A 预算和报告', () => {
  it('预算计入首轮、全部区域及双向对象字节，执行前拒绝超额', () => {
    expect(imageBenchmarkPlan(manifest)).toMatchObject({ requests: 6, transferBytes: 3 * 1024 * 1024, generationCalls: 0, credits: 0 })
    expect(() => imageBenchmarkPlan({ ...manifest, maxRequests: 5 })).toThrow('超过')
    expect(() => imageBenchmarkPlan({ ...manifest, maxTransferMiB: 1 })).toThrow('超过')
  })
  it('区域、部署、提交或配置变化均停止，防止混算对照', () => {
    for (const patch of [{ region: 'hkg1' }, { revision: 'c'.repeat(40) }, { deployment: 'other.vercel.app' }, { configuration: 'c'.repeat(64) }])
      expect(() => validateBenchmarkSample(manifest, { ...sample(), result: { ...sample().result, ...patch } }, sample())).toThrow()
  })
  it('预热排除，失败与缺失样本显示；重复记录拒绝', () => {
    const rows = [sample(0), sample(1), sample(2, 'failed')]
    const summary = summarizeImageBenchmark(manifest, rows).find(row => row.case === 'storage-small')!
    expect(summary).toMatchObject({ received: 2, failed: 1, requestP50: 100, phases: { total: { p50: 20 } } })
    expect(renderImageBenchmarkReport(manifest, rows)).toContain('0/2')
    expect(() => summarizeImageBenchmark(manifest, [sample(), sample()])).toThrow('重复')
  })
})
