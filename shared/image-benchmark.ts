import { z } from 'zod'

export const IMAGE_BENCHMARK_CASES = ['control', 'database', 'storage-small', 'storage-large', 'qwen-connect', 'tencent-connect'] as const
export const IMAGE_BENCHMARK_BYTES = { 'storage-small': 512 * 1024, 'storage-large': 5 * 1024 * 1024 } as const
export const imageBenchmarkRequest = z.object({
  runId: z.uuid(),
  case: z.enum(IMAGE_BENCHMARK_CASES),
  sample: z.number().int().min(0).max(40),
}).strict()
export type ImageBenchmarkRequest = z.infer<typeof imageBenchmarkRequest>
export const imageBenchmarkResult = imageBenchmarkRequest.extend({
  version: z.literal(1),
  environment: z.literal('preview'),
  region: z.string().min(1),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  deployment: z.string().min(1),
  configuration: z.string().regex(/^[a-f0-9]{64}$/),
  instance: z.uuid(),
  instanceRequest: z.number().int().positive(),
  node: z.string(),
  memoryMb: z.number().nonnegative().nullable(),
  outcome: z.enum(['success', 'failed', 'skipped']),
  errorCode: z.string().optional(),
  phases: z.record(z.string(), z.number().nonnegative()),
  bytes: z.number().int().nonnegative(),
  cleanup: z.enum(['not_needed', 'success', 'failed']),
}).strict()
export type ImageBenchmarkResult = z.infer<typeof imageBenchmarkResult>

export const imageBenchmarkManifest = z.object({
  version: z.literal(1),
  runId: z.uuid(),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  rounds: z.number().int().min(1).max(40).default(20),
  maxRequests: z.number().int().min(1).max(800).default(400),
  maxTransferMiB: z.number().positive().max(2048).default(1024),
  cases: z.array(z.enum(IMAGE_BENCHMARK_CASES)).min(1).refine(v => v[0] === 'control' && new Set(v).size === v.length,
    '必须先验证 control，且场景不能重复'),
  targets: z.array(z.object({
    region: z.enum(['pdx1', 'hkg1', 'sin1']),
    url: z.url().refine(raw => {
      const url = new URL(raw)
      return url.protocol === 'https:' && url.hostname.endsWith('.vercel.app') && !url.username && !url.password
        && url.pathname === '/' && !url.search && !url.hash
    }, '必须使用独立预览部署的 HTTPS 根地址'),
  }).strict()).min(1).max(3).refine(v => new Set(v.map(t => t.region)).size === v.length
    && new Set(v.map(t => t.url)).size === v.length),
}).strict()
export type ImageBenchmarkManifest = z.infer<typeof imageBenchmarkManifest>
export interface ImageBenchmarkSample { result: ImageBenchmarkResult; requestMs: number }

export function imageBenchmarkPlan(manifest: ImageBenchmarkManifest) {
  const requests = (manifest.rounds + 1) * manifest.targets.length * manifest.cases.length
  const transferBytes = (manifest.rounds + 1) * manifest.targets.length * manifest.cases.reduce((sum, name) =>
    sum + (name in IMAGE_BENCHMARK_BYTES ? IMAGE_BENCHMARK_BYTES[name as keyof typeof IMAGE_BENCHMARK_BYTES] * 2 : 0), 0)
  if (requests > manifest.maxRequests || transferBytes > manifest.maxTransferMiB * 1024 * 1024)
    throw new Error('基准请求数或对象传输量超过清单预算')
  return { requests, transferBytes, generationCalls: 0, credits: 0, warmupPerCase: 1 }
}
