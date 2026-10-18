import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  suiteAssetSchema, suiteAssetAccessRequestSchema, suiteBridgeResultRequestSchema,
  suiteBatchSchema, suiteBridgeSchema, suiteOperationSchema, suiteCompositionSchema, suiteCreateBatchRequestSchema, suiteCreateBridgeRequestSchema,
  suiteCreateProjectRequestSchema, suiteExportConfigSchema, suiteFactSchema, suiteOriginSchema,
  suitePrecheckRequestSchema, suiteProjectSchema, suiteQuoteRequestSchema, suiteQuoteSchema,
  suiteSaveDraftRequestSchema, suiteSaveVersionRequestSchema, suiteSetCurrentRequestSchema, suiteTagsSchema,
  suiteUpdateProjectRequestSchema, suiteUploadCompleteRequestSchema, suiteUploadRequestSchema, suiteVersionSchema,
} from './ecommerce-suite.js'
import { SUITE_CATEGORY_TEMPLATES } from './ecommerce-suite-templates.js'
import { taskOriginSchema, taskSourceKinds, taskTools } from './task-center.js'

const examples = JSON.parse(readFileSync(new URL('../docs/verification/ecommerce-suite/phase-one/contract-fixtures.json', import.meta.url), 'utf8'))
const create = suiteCreateProjectRequestSchema.parse(examples.createProject)
const quote = suiteQuoteSchema.parse(examples.quote)
const version = suiteVersionSchema.parse(examples.version)
const project = suiteProjectSchema.parse(examples.project)

describe('电商套图阶段一：冻结契约与边界', () => {
  it('脱敏合同样例通过所有已冻结入口与核心读模型', () => {
    const schemas = {
      createProject: suiteCreateProjectRequestSchema, updateProject: suiteUpdateProjectRequestSchema,
      project: suiteProjectSchema, asset: suiteAssetSchema, upload: suiteUploadRequestSchema,
      uploadComplete: suiteUploadCompleteRequestSchema, assetAccess: suiteAssetAccessRequestSchema,
      quoteRequest: suiteQuoteRequestSchema, quote: suiteQuoteSchema, createBatch: suiteCreateBatchRequestSchema,
      version: suiteVersionSchema, saveDraft: suiteSaveDraftRequestSchema, saveVersion: suiteSaveVersionRequestSchema, setCurrent: suiteSetCurrentRequestSchema,
      origin: suiteOriginSchema, createBridge: suiteCreateBridgeRequestSchema,
      bridgeResult: suiteBridgeResultRequestSchema, precheck: suitePrecheckRequestSchema,
      batch: suiteBatchSchema, operation: suiteOperationSchema, bridge: suiteBridgeSchema,
    }
    for (const [key, schema] of Object.entries(schemas)) expect(schema.safeParse(examples[key]).success, key).toBe(true)
    expect(examples.evidenceKind).toBe('synthetic_contract_only')
  })

  it('客户端写入不能夹带归属、积分、签名 URL 或后台执行状态', () => {
    for (const extra of [{ actor: project.actor }, { userId: project.actor.userId }, { scope: 'production' }, { credits: 0 }, { imageUrl: 'https://example.invalid/?signature=secret' }, { status: 'running' }]) {
      expect(suiteCreateProjectRequestSchema.safeParse({ ...create, ...extra }).success).toBe(false)
      expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, ...extra } }).success).toBe(false)
    }
    expect(suiteCreateBatchRequestSchema.safeParse({ ...examples.createBatch, billingState: 'settled' }).success).toBe(false)
  })

  it('主图按语义保护，序号变化可接受但 Amazon 主图不能跳过', () => {
    const moved = structuredClone(create)
    moved.config.slots[0].order = 4
    moved.config.slots[4].order = 0
    expect(suiteCreateProjectRequestSchema.safeParse(moved).success).toBe(true)
    moved.config.slots[0].enabled = false
    expect(suiteCreateProjectRequestSchema.safeParse(moved).success).toBe(false)
  })

  it.each(['id', 'key', 'order'] as const)('拒绝重复槽位 %s，避免错误结果覆盖与重复派发', key => {
    const slots = create.config.slots.map((slot, index) => index === 1 ? { ...slot, [key]: create.config.slots[0][key] } : slot)
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, slots } }).success).toBe(false)
  })

  it('拒绝缺失槽位、伪造当前版本归属与重复指针', () => {
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, slots: create.config.slots.slice(1) } }).success).toBe(false)
    for (const slotId of ['ffffffff-ffff-4fff-8fff-ffffffffffff', project.slotHeads[0].slotId]) {
      expect(suiteProjectSchema.safeParse({ ...project, slotHeads: project.slotHeads.map((head, i) => i === 1 ? { ...head, slotId } : head) }).success).toBe(false)
    }
  })

  it('站点范围与平台对应，通用配置不冒充 Amazon 规则', () => {
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, marketplace: undefined } }).success).toBe(false)
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, platform: 'general' } }).success).toBe(false)
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, platform: 'general', marketplace: undefined } }).success).toBe(true)
  })

  it('标签去空白后检测重复，尺寸保持语义且拒绝错误单位／数值', () => {
    expect(suiteTagsSchema.parse([' 自然光 '])).toEqual(['自然光'])
    expect(suiteTagsSchema.safeParse(['自然光', ' 自然光 ']).success).toBe(false)
    const fact = create.config.facts[0]
    for (const invalid of [{ value: -1 }, { value: Number.NaN }, { value: Infinity }, { unit: 'kg' }])
      expect(suiteFactSchema.safeParse({ ...fact, ...invalid }).success).toBe(false)
    expect(fact).toMatchObject({ kind: 'dimension', axis: 'length', value: 210, unit: 'cm' })
  })

  it('同一尺寸方向不能同时保存两个冲突规格', () => {
    const facts = [...create.config.facts, { ...create.config.facts[0], id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', value: 999 }]
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, facts } }).success).toBe(false)
  })

  it('不同测量对象可以分别记录同方向尺寸，整体与部件不会混淆', () => {
    const facts = [...create.config.facts, { ...create.config.facts[0], id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', subject: 'shelf-tier-1', value: 50 }]
    expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, facts } }).success).toBe(true)
  })

  it('历史快照不能引用未确认、缺失或文字型的尺寸事实', () => {
    const snapshot = version.composition
    expect(suiteCompositionSchema.safeParse({ ...snapshot, factsSnapshot: [] }).success).toBe(false)
    expect(suiteCompositionSchema.safeParse({ ...snapshot, factsSnapshot: snapshot.factsSnapshot.map(fact => ({ ...fact, confirmed: false })) }).success).toBe(false)
    const fact = snapshot.factsSnapshot[0]
    const material = { id: fact.id, kind: 'material', name: '材质', value: '布料', originalText: '布料', source: 'user', confirmed: true }
    expect(suiteCompositionSchema.safeParse({ ...snapshot, factsSnapshot: [material] }).success).toBe(false)
  })

  it('拒绝越界和退化标注线，避免预览与导出坐标失真', () => {
    const snapshot = version.composition, layer = snapshot.layersSnapshot[0]
    if (layer.type !== 'dimension') throw new Error('样例必须包含尺寸线')
    for (const invalid of [{ start: { x: -0.1, y: 0 } }, { end: layer.start }, { labelPosition: { x: 1.1, y: 0 } }])
      expect(suiteCompositionSchema.safeParse({ ...snapshot, layersSnapshot: [{ ...layer, ...invalid }] }).success).toBe(false)
  })

  it('暂未完成的空文字可以保存草稿，但不能保存为成品版本', () => {
    const text = { id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', type: 'text', text: '', position: { x: 0.1, y: 0.1 }, width: 0.5, fontFamily: 'Noto Sans SC', fontSize: 36, fontWeight: 400, color: '#17171a', background: '#ffffff', align: 'left', zIndex: 0 }
    expect(suiteSaveDraftRequestSchema.safeParse({ ...examples.saveDraft, layers: [text] }).success).toBe(true)
    expect(suiteCompositionSchema.safeParse({ ...version.composition, layersSnapshot: [text] }).success).toBe(false)
  })

  it('候选数量、模型费用及报价合计必须一致', () => {
    expect(quote).toMatchObject({ totalCredits: 14, items: [{ count: 2, unitCredits: 7, credits: 14 }] })
    expect(suiteQuoteSchema.safeParse({ ...quote, totalCredits: 7 }).success).toBe(false)
    expect(suiteQuoteSchema.safeParse({ ...quote, items: quote.items.map(item => ({ ...item, count: 4 })) }).success).toBe(false)
    expect(suiteQuoteSchema.safeParse({ ...quote, items: [...quote.items, ...quote.items], totalCredits: 28 }).success).toBe(false)
  })

  it('主图／尺寸不能通过批次直接改为收费重造，复用费用必须为零', () => {
    for (const slotKind of ['main', 'size'])
      expect(suiteQuoteSchema.safeParse({ ...quote, items: quote.items.map(item => ({ ...item, slotKind })) }).success).toBe(false)
    const item = quote.items[0]
    const reuse = { operationId: item.operationId, slotId: item.slotId, slotKind: 'main', sourceAssetId: item.sourceAssetId, mode: 'reuse', count: 1, credits: 1 }
    expect(suiteQuoteSchema.safeParse({ ...quote, items: [reuse], totalCredits: 1 }).success).toBe(false)
  })

  it('报价十分钟有效，客户端不能扩张候选数量或提交自己计算的明细', () => {
    expect(suiteQuoteSchema.safeParse({ ...quote, expiresAt: '2026-10-17T00:11:00Z' }).success).toBe(false)
    expect(suiteCreateBatchRequestSchema.safeParse({ ...examples.createBatch, items: quote.items }).success).toBe(false)
    expect(suiteQuoteRequestSchema.safeParse({ ...examples.quoteRequest, slots: [...examples.quoteRequest.slots, ...examples.quoteRequest.slots] }).success).toBe(false)
  })

  it('读取授权可以指定缩略图，旧请求仍只签原图', () => {
    expect(suiteAssetAccessRequestSchema.safeParse(examples.assetAccess).success).toBe(true)
    expect(suiteAssetAccessRequestSchema.safeParse({ ...examples.assetAccess, variant: 'thumbnail' }).success).toBe(true)
    expect(suiteAssetAccessRequestSchema.safeParse({ ...examples.assetAccess, variant: 'preview' }).success).toBe(false)
    expect(suiteAssetAccessRequestSchema.safeParse({ ...examples.assetAccess, url: 'https://example.invalid/signed' }).success).toBe(false)
  })

  it('长期资产拒绝临时路径、签名地址和目录穿越', () => {
    for (const objectKey of ['temporary/task-inputs/test', 'https://example.invalid/file', 'suite-assets/a?signature=secret', 'suite-assets/../other'])
      expect(suiteAssetSchema.safeParse({ ...examples.asset, objectKey }).success).toBe(false)
    expect(suiteUploadRequestSchema.safeParse({ ...examples.upload, bytes: 20 * 1024 * 1024 + 1 }).success).toBe(false)
    expect(suiteUploadRequestSchema.safeParse({ ...examples.upload, mimeType: 'image/svg+xml' }).success).toBe(false)
  })

  it('版本不能伪造收费来源，回填必须保留真实工具与结果', () => {
    expect(suiteVersionSchema.safeParse({ ...version, modelProfileId: 'fixture:image-edit-only' }).success).toBe(false)
    expect(suiteVersionSchema.safeParse({ ...version, source: 'generated' }).success).toBe(false)
    expect(suiteVersionSchema.safeParse({ ...version, source: 'workstation_return' }).success).toBe(false)
    expect(suiteBridgeResultRequestSchema.safeParse({ ...examples.bridgeResult, result: { ...examples.bridgeResult.result, ordinal: 1 } }).success).toBe(false)
    expect(suiteCreateBridgeRequestSchema.safeParse({ ...examples.createBridge, imageUrl: 'https://example.invalid/' }).success).toBe(false)
  })

  it('平台导出格式边界明确，JPEG 不接受透明背景', () => {
    const output = examples.precheck.output
    expect(suiteExportConfigSchema.safeParse({ ...output, format: 'webp' }).success).toBe(false)
    expect(suiteExportConfigSchema.safeParse({ ...output, format: 'webp', platform: 'general' }).success).toBe(true)
    expect(suiteExportConfigSchema.safeParse({ ...output, background: 'transparent' }).success).toBe(false)
  })

  it('三类模板都可形成合法配置，推荐标签只提供风格', () => {
    for (const [subcategory, template] of Object.entries(SUITE_CATEGORY_TEMPLATES)) {
      const slots = template.slots.map((slot, index) => ({ ...create.config.slots[index], key: slot.key, kind: slot.kind, name: slot.name }))
      expect(suiteCreateProjectRequestSchema.safeParse({ ...create, config: { ...create.config, subcategory, slots } }).success).toBe(true)
      expect(template.styleTags.join(' ')).not.toMatch(/食品级|99%|304|承重|防猫抓/)
    }
  })

  it('子任务来源和只读父批次身份均已接入', () => {
    expect(suiteOriginSchema.safeParse(examples.origin).success).toBe(true)
    expect(taskOriginSchema.safeParse(examples.origin).success).toBe(true)
    expect([...taskTools]).toContain('ecommerce-suite')
    expect([...taskSourceKinds]).toContain('suite_batch')
  })

  it('操作不能改写已绑定任务为停止、串联其他请求或让复用步骤扣费', () => {
    const task = { sourceKind: 'image_job', sourceId: 'ffffffff-ffff-4fff-8fff-ffffffffffff', requestId: examples.operation.requestId }
    expect(suiteOperationSchema.safeParse({ ...examples.operation, phase: 'bound', task }).success).toBe(true)
    expect(suiteOperationSchema.safeParse({ ...examples.operation, phase: 'stopped', task }).success).toBe(false)
    expect(suiteOperationSchema.safeParse({ ...examples.operation, phase: 'bound', task: { ...task, requestId: task.sourceId } }).success).toBe(false)
    expect(suiteOperationSchema.safeParse({ ...examples.operation, mode: 'reuse', task }).success).toBe(false)
    expect(suiteBatchSchema.safeParse({ ...examples.batch, billingState: 'reserved' }).success).toBe(false)
  })
})
