import { readFile, appendFile, writeFile } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { performance } from 'node:perf_hooks'
import { parseArgs } from 'node:util'
import { IMAGE_BENCHMARK_BYTES, imageBenchmarkManifest, imageBenchmarkPlan, type ImageBenchmarkSample } from '../../shared/image-benchmark.js'
import { renderImageBenchmarkReport, validateBenchmarkSample } from './report.js'

const options = parseArgs({ options: {
  manifest: { type: 'string' }, output: { type: 'string' }, execute: { type: 'boolean' },
  resume: { type: 'boolean' }, 'report-only': { type: 'boolean' }, 'via-vercel': { type: 'boolean' },
} }).values
if (!options.manifest || !options.output) throw new Error('必须指定 --manifest 和 --output 私有结果路径')
const manifest = imageBenchmarkManifest.parse(JSON.parse(await readFile(options.manifest, 'utf8')))
const plan = imageBenchmarkPlan(manifest)
const fingerprint = createHash('sha256').update(JSON.stringify(manifest)).digest('hex')
console.log(JSON.stringify({ runId: manifest.runId, ...plan, execution: !!options.execute }))

if (options.execute || options['report-only']) {
  const output = options.output
  const rows: ImageBenchmarkSample[] = []
  const attempts: Array<{ type: 'attempt'; region: string; case: typeof manifest.cases[number]; sample: number }> = []
  let existing: string | undefined
  try { existing = await readFile(output, 'utf8') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  if (existing !== undefined) {
    if (!options.resume && !options['report-only']) throw new Error('结果文件已存在，请显式使用 --resume 或换路径')
    const [header, ...records] = existing.trim().split('\n').map(line => JSON.parse(line))
    if (header.manifest !== fingerprint) throw new Error('已有记录属于另一份清单')
    for (const row of records) {
      if (row.type === 'attempt') {
        if (!manifest.targets.some(t => t.region === row.region) || !manifest.cases.includes(row.case)
          || !Number.isInteger(row.sample) || row.sample < 0 || row.sample > manifest.rounds) throw new Error('请求日志不匹配清单')
        attempts.push(row)
      } else rows.push(validateBenchmarkSample(manifest, row, rows[0]))
    }
    // 同时检查重复记录，恢复不会再次发出已有样本的请求。
    renderImageBenchmarkReport(manifest, rows)
  } else if (options['report-only']) throw new Error('报告输入文件不存在')
  else await writeFile(output, JSON.stringify({ version: 1, manifest: fingerprint }) + '\n', { mode: 0o600, flag: 'wx' })

  if (options.execute) {
    const token = process.env.IMAGE_BENCHMARK_TOKEN
    if (!token || token.length < 32) throw new Error('缺少 IMAGE_BENCHMARK_TOKEN')
    if (options['via-vercel'] && !process.env.VERCEL_CLI_ENTRYPOINT) throw new Error('必须指定已登录的 VERCEL_CLI_ENTRYPOINT')
    const done = new Set(attempts.map(row => `${row.region}:${row.case}:${row.sample}`))
    if (done.size !== attempts.length) throw new Error('请求日志包含重复尝试')
    const completed = new Set(rows.map(row => `${row.result.region}:${row.result.case}:${row.result.sample}`))
    if ([...done].some(key => !completed.has(key))) throw new Error('存在回执未知的请求；保留缺失样本，不自动重发，请先生成报告')
    let attempted = attempts.length
    let transferred = attempts.reduce((sum, row) => sum + (row.case in IMAGE_BENCHMARK_BYTES
      ? IMAGE_BENCHMARK_BYTES[row.case as keyof typeof IMAGE_BENCHMARK_BYTES] * 2 : 0), 0)
    const failures = new Map<string, number>()
    try {
      for (let sample = 0; sample <= manifest.rounds; sample++) {
        for (const name of manifest.cases) {
          // 轮次轮换首区域，降低固定测试顺序和时间波动的影响。
          const targets = [...manifest.targets.slice(sample % manifest.targets.length), ...manifest.targets.slice(0, sample % manifest.targets.length)]
          for (const target of targets) {
            const key = `${target.region}:${name}:${sample}`
            if (done.has(key)) continue
            const bytes = name in IMAGE_BENCHMARK_BYTES ? IMAGE_BENCHMARK_BYTES[name as keyof typeof IMAGE_BENCHMARK_BYTES] * 2 : 0
            if (++attempted > manifest.maxRequests || (transferred += bytes) > manifest.maxTransferMiB * 1024 * 1024)
              throw new Error('已到本轮请求或传输预算上限')
            const body = JSON.stringify({ runId: manifest.runId, case: name, sample })
            await appendFile(output, JSON.stringify({ type: 'attempt', region: target.region, case: name, sample }) + '\n')
            const at = performance.now()
            let raw: unknown
            if (options['via-vercel']) {
              const { stdout } = await promisify(execFile)(process.execPath, [process.env.VERCEL_CLI_ENTRYPOINT!, 'curl',
                '/api/internal/image-benchmark', '--deployment', target.url, '--', '--request', 'POST', '--header', `Authorization: Bearer ${token}`,
                '--header', 'Content-Type: application/json', '--data', body, '--silent', '--show-error', '--fail'], { timeout: 65_000, maxBuffer: 128 * 1024 })
              raw = JSON.parse(stdout)
            } else {
              const response = await fetch(new URL('/api/internal/image-benchmark', target.url), { method: 'POST', redirect: 'error',
                headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
                  ...(process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { 'x-vercel-protection-bypass': process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {}) },
                body, signal: AbortSignal.timeout(60_000) })
              if (!response.ok) throw new Error(`基准 HTTP ${response.status}，已停止，不重发 POST`)
              raw = await response.json()
            }
            const row = validateBenchmarkSample(manifest, { result: raw as ImageBenchmarkSample['result'], requestMs: performance.now() - at }, rows[0])
            if (row.result.region !== target.region || row.result.case !== name || row.result.sample !== sample) throw new Error('响应与本次请求不匹配')
            rows.push(row)
            await appendFile(output, JSON.stringify(row) + '\n')
            done.add(key)
            console.log(JSON.stringify({ region: target.region, case: name, sample, outcome: row.result.outcome, ms: Math.round(row.result.phases.total) }))
            const failureKey = `${target.region}:${name}`
            failures.set(failureKey, row.result.outcome === 'success' ? 0 : (failures.get(failureKey) ?? 0) + 1)
            if (failures.get(failureKey)! >= 3) throw new Error('同区域同场景连续三次失败或跳过，已停止')
          }
        }
      }
    } catch (error) {
      // 子进程错误可能包含鉴权参数；只向终端写固定分类，完整调用文本不输出。
      process.exitCode = 1
      console.error(error instanceof Error && !('cmd' in error) ? error.message : '基准传输失败，已保存已完成样本；没有自动重发')
    }
  }
  await writeFile(output + '.md', renderImageBenchmarkReport(manifest, rows), { mode: 0o600 })
}
