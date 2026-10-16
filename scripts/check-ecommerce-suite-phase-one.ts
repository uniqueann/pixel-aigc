import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { z } from 'zod'
import * as contract from '../shared/ecommerce-suite.js'
import { SUITE_CATEGORY_TEMPLATES } from '../shared/ecommerce-suite-templates.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const evidence = 'docs/verification/ecommerce-suite/phase-one'
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const fixtures = JSON.parse(read(`${evidence}/contract-fixtures.json`)) as Record<string, unknown>
if (fixtures.evidenceKind !== 'synthetic_contract_only') throw new Error('合同样例必须明确标记为合成证据')

const schemas = {
  createProject: contract.suiteCreateProjectRequestSchema, updateProject: contract.suiteUpdateProjectRequestSchema,
  project: contract.suiteProjectSchema, asset: contract.suiteAssetSchema, upload: contract.suiteUploadRequestSchema,
  uploadComplete: contract.suiteUploadCompleteRequestSchema, assetAccess: contract.suiteAssetAccessRequestSchema,
  quoteRequest: contract.suiteQuoteRequestSchema, quote: contract.suiteQuoteSchema, createBatch: contract.suiteCreateBatchRequestSchema,
  version: contract.suiteVersionSchema, saveDraft: contract.suiteSaveDraftRequestSchema, saveVersion: contract.suiteSaveVersionRequestSchema,
  setCurrent: contract.suiteSetCurrentRequestSchema, origin: contract.suiteOriginSchema,
  createBridge: contract.suiteCreateBridgeRequestSchema, bridgeResult: contract.suiteBridgeResultRequestSchema, precheck: contract.suitePrecheckRequestSchema,
  batch: contract.suiteBatchSchema, operation: contract.suiteOperationSchema, bridge: contract.suiteBridgeSchema,
}
for (const [name, schema] of Object.entries(schemas)) schema.parse(fixtures[name])
const input = contract.suiteCreateProjectRequestSchema.parse(fixtures.createProject)
for (const [subcategory, template] of Object.entries(SUITE_CATEGORY_TEMPLATES)) {
  const slots = template.slots.map((slot, index) => ({ ...input.config.slots[index], key: slot.key, kind: slot.kind, name: slot.name }))
  contract.suiteCreateProjectRequestSchema.parse({ ...input, config: { ...input.config, subcategory, slots } })
}

const samples = z.object({
  evidenceKind: z.literal('real_sample_collection_plan'), requiredCount: z.literal(9), receivedCount: z.number().int().min(0).max(9),
  samples: z.array(z.object({
    sampleId: z.string().regex(/^[FKS]0[123]$/), subcategory: z.enum(contract.SUITE_SUBCATEGORIES), product: z.string().min(1), focus: z.string().min(1),
    status: z.enum(['awaiting_input', 'ready']), assetIds: z.array(z.uuid()), verifiedFacts: z.array(contract.suiteFactSchema),
    accepted: z.boolean(), requiredInputs: z.array(z.string()).min(1), evidence: z.string().nullable(),
  }).strict()).length(9),
}).strict().parse(JSON.parse(read(`${evidence}/sample-plan.json`)))
const received = samples.samples.filter(sample => sample.status === 'ready')
if (new Set(samples.samples.map(sample => sample.sampleId)).size !== 9 || samples.receivedCount !== received.length)
  throw new Error('真实样本编号或接收计数不一致')
for (const subcategory of contract.SUITE_SUBCATEGORIES)
  if (samples.samples.filter(sample => sample.subcategory === subcategory).length !== 3) throw new Error('每个子类必须规划三个真实样本')
for (const sample of samples.samples) {
  if (sample.status === 'ready' && (!sample.assetIds.length || !sample.verifiedFacts.length || sample.verifiedFacts.some(fact => !fact.confirmed)))
    throw new Error('样本资料未齐，不能标记已收到')
  if (sample.accepted && (sample.status !== 'ready' || !sample.evidence)) throw new Error('缺少真实验收证据')
}

const prototype = 'docs/prototypes/ecommerce-suite/workspace-v1.zip'
const archiveHash = createHash('sha256').update(readFileSync(resolve(root, prototype))).digest('hex')
if (archiveHash !== '4a100dba9c3dc120c2c9d8bb1639b653cdfaf365bebf0e44b304a5986670e048') throw new Error('原型归档发生变化')
const documents = [
  'docs/ecommerce-suite-development-plan.md', 'docs/ecommerce-suite-phase-one-contract.md',
  'docs/ecommerce-suite-database-contract.md', 'docs/ecommerce-suite-failure-matrix.md', `${evidence}/README.md`,
]
let linkCount = 0
for (const path of documents) {
  const markdown = read(path)
  if ((markdown.match(/^```/gm)?.length ?? 0) % 2) throw new Error(`${path} 代码块未闭合`)
  for (const [, link] of markdown.matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(https?:\/\/|#)/.test(link)) continue
    const target = resolve(root, dirname(path), link.split('#')[0])
    // 报告在首次写入时还不存在，仅允许跳过当前输出文件本身。
    if (target === resolve(root, evidence, 'local-checks.json')) continue
    readFileSync(target)
    linkCount++
  }
}

const report = {
  kind: 'phase_one_contract_checks', contractVersion: contract.SUITE_CONTRACT_VERSION,
  checkedAt: new Date().toISOString(), worktreeBaseCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  contractChecksPassed: true, validatedExamples: Object.keys(schemas).length, validatedTemplates: Object.keys(SUITE_CATEGORY_TEMPLATES).length,
  checkedLocalLinks: linkCount, prototypeSha256: archiveHash,
  sourceHashes: Object.fromEntries(['shared/ecommerce-suite.ts', 'shared/ecommerce-suite-templates.ts', 'shared/ecommerce-suite.test.ts']
    .map(path => [path, createHash('sha256').update(read(path)).digest('hex')])),
  realSampleGatePassed: received.length === samples.requiredCount,
  realSamples: { required: samples.requiredCount, received: received.length, accepted: samples.samples.filter(sample => sample.accepted).length },
  runtimeVerification: { http: 'not_implemented', postgresRls: 'design_only', billing: 'not_executed', scheduler: 'not_implemented', provider: 'not_executed' },
}
if (process.argv.includes('--write-report')) writeFileSync(resolve(root, evidence, 'local-checks.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
