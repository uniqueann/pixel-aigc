import { imageBenchmarkResult, type ImageBenchmarkManifest, type ImageBenchmarkSample } from '../../shared/image-benchmark.js'

export function validateBenchmarkSample(manifest: ImageBenchmarkManifest, raw: ImageBenchmarkSample, prior?: ImageBenchmarkSample) {
  const result = imageBenchmarkResult.parse(raw.result)
  const target = manifest.targets.find(value => value.region === result.region)
  if (!target || result.deployment !== new URL(target.url).host || result.revision !== manifest.revision || result.runId !== manifest.runId
    || result.sample > manifest.rounds || !manifest.cases.includes(result.case) || !Number.isFinite(raw.requestMs) || raw.requestMs < 0)
    throw new Error('部署、区域、提交、轮次或测试清单不匹配')
  if (prior && (result.configuration !== prior.result.configuration || result.node !== prior.result.node || result.memoryMb !== prior.result.memoryMb))
    throw new Error('区域间的依赖配置或运行规格不一致')
  return { result, requestMs: raw.requestMs }
}

function quantile(values: number[], q: number) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? Math.round(sorted[Math.max(0, Math.ceil(sorted.length * q) - 1)]) : null
}

/** 首轮仅作预热；失败和跳过单列，不能用成功样本掩盖失败。 */
export function summarizeImageBenchmark(manifest: ImageBenchmarkManifest, rows: ImageBenchmarkSample[]) {
  const seen = new Set<string>()
  for (const row of rows) {
    validateBenchmarkSample(manifest, row, rows[0])
    const key = `${row.result.region}:${row.result.case}:${row.result.sample}`
    if (seen.has(key)) throw new Error('报告包含重复样本')
    seen.add(key)
  }
  return manifest.targets.flatMap(target => manifest.cases.map(name => {
    const samples = rows.filter(row => row.result.region === target.region && row.result.case === name && row.result.sample > 0)
    const successful = samples.filter(row => row.result.outcome === 'success')
    return { region: target.region, case: name, expected: manifest.rounds, received: samples.length,
      failed: samples.filter(row => row.result.outcome === 'failed').length,
      skipped: samples.filter(row => row.result.outcome === 'skipped').length,
      requestP50: quantile(successful.map(row => row.requestMs), 0.5),
      requestP95: quantile(successful.map(row => row.requestMs), 0.95),
      phases: Object.fromEntries([...new Set(successful.flatMap(row => Object.keys(row.result.phases)))].sort().map(phase => {
        const values = successful.map(row => row.result.phases[phase]).filter(value => value !== undefined)
        return [phase, { n: values.length, p50: quantile(values, 0.5), p95: quantile(values, 0.95) }]
      })),
    }
  }))
}

export function renderImageBenchmarkReport(manifest: ImageBenchmarkManifest, rows: ImageBenchmarkSample[]) {
  const summary = summarizeImageBenchmark(manifest, rows)
  const lines = ['# P2-A 预览网络与存储区域对照', '', `提交：\`${manifest.revision}\`；运行：\`${manifest.runId}\`。`, '',
    '单位为毫秒。首轮预热不计入统计；成功耗时分位数与失败、跳过、缺失样本分别报告。小样本 p95 仅供描述。', '',
    '| 区域 | 场景 | 已收/计划 | 失败 | 跳过 | 请求 p50 | 请求 p95 | 服务端 p50 |',
    '|---|---|---:|---:|---:|---:|---:|---:|',
    ...summary.map(row => `| ${row.region} | ${row.case} | ${row.received}/${row.expected} | ${row.failed} | ${row.skipped} | ${row.requestP50 ?? '—'} | ${row.requestP95 ?? '—'} | ${row.phases.total?.p50 ?? '—'} |`), '',
    '## 分段', '', '| 区域 | 场景 | 阶段 | 成功样本 | p50 | p95 |', '|---|---|---|---:|---:|---:|',
    ...summary.flatMap(row => Object.entries(row.phases).map(([name, phase]) => `| ${row.region} | ${row.case} | ${name} | ${phase.n} | ${phase.p50} | ${phase.p95} |`)), '',
    '## 结论边界', '',
    '- 这是实际预览部署的基础链路对照，不含模型生成、腾讯识别、浏览器直传或完整出图；不扣站内积分，存储请求与传输仍计入云服务用量。',
    '- TLS 场景每次新建连接，只说明到供应商入口的 DNS、TCP、TLS 路径，不表示实际处理 API 或模型更快。',
    '- 数据库 acquireAndBegin 包含连接池排队、必要的连接建立和 BEGIN；query 是原身份与 preview 范围下的业务只读查询。',
    '- instance 与 instanceRequest 只标记本进程及调用次序，不能据此判断平台冷启动；预览结果不能替代生产冷启动测试。',
    '- requestMs 包含测试控制端到部署的路径；区域筛选优先比较服务端分段。阶段存在包含关系，不能直接相加。',
    '- 未完成完整工具对照前，不据此修改正式站区域或宣称达到 4 秒目标。', '']
  return lines.join('\n')
}
