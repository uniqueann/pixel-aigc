import { z } from 'zod'
import { PROMPT_MAX_LENGTH } from './prompt-limits.js'

/** 阶段一仅冻结契约，不注册路由、任务来源或收费能力。 */
export const SUITE_CONTRACT_VERSION = 1
export const SUITE_LIMITS = {
  slots: 7, tags: 30, tagLength: 80, facts: 50, layers: 20, textLength: 200,
  uploadBytes: 20 * 1024 * 1024, quoteTtlMs: 10 * 60_000,
  dispatchWindowMs: 30 * 60_000, bridgeTtlMs: 7 * 86_400_000, trashTtlMs: 7 * 86_400_000,
} as const
export const SUITE_SUBCATEGORIES = ['furniture', 'kitchen-dining', 'storage-textile'] as const
export const SUITE_SLOT_KEYS = ['main', 'scene', 'secondary', 'feature', 'size', 'detail', 'use'] as const
export const SUITE_SLOT_KINDS = ['main', 'scene', 'atmosphere', 'feature', 'size', 'detail', 'use'] as const
export const SUITE_BATCH_STATES = ['queued', 'running', 'blocked', 'succeeded', 'partial', 'failed', 'stopped'] as const
export const SUITE_OPERATION_PHASES = ['waiting', 'dispatching', 'confirming', 'bound', 'blocked', 'stopped'] as const
export const SUITE_ERROR_CODES = [
  'SUITE_NOT_FOUND', 'SUITE_REVISION_CONFLICT', 'SUITE_HEAD_CONFLICT', 'SUITE_REQUEST_CONFLICT',
  'SUITE_BATCH_ACTIVE', 'SUITE_QUOTE_EXPIRED', 'SUITE_QUOTE_CHANGED', 'SUITE_FACTS_REQUIRED',
  'SUITE_ASSET_UNAVAILABLE', 'SUITE_BRIDGE_EXPIRED', 'SUITE_RESULT_CONFLICT',
] as const

const id = z.uuid()
const label = z.string().trim().min(1).max(100)
const revision = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const credits = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const instant = z.iso.datetime({ offset: true })
const checksum = z.string().regex(/^[a-f0-9]{64}$/)
const color = z.string().regex(/^#[a-fA-F0-9]{6}$/)
const size = z.object({ width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) }).strict()
const unique = (values: readonly unknown[]) => new Set(values).size === values.length
export const suiteActorSchema = z.object({ userId: id, runtimeScope: z.enum(['local', 'preview', 'production']) }).strict()
export const suiteTagsSchema = z.array(z.string().trim().min(1).max(SUITE_LIMITS.tagLength))
  .max(SUITE_LIMITS.tags).refine(unique, '标签不能重复')

const factBase = {
  id, name: label, originalText: z.string().trim().min(1).max(300),
  source: z.enum(['user', 'tag_parse']), confirmed: z.boolean(),
}
export const suiteFactSchema = z.discriminatedUnion('kind', [
  z.object({ ...factBase, kind: z.literal('dimension'), subject: z.string().trim().min(1).max(60).default('product'), axis: z.enum(['length', 'width', 'height', 'depth', 'diameter']), value: z.number().finite().positive(), unit: z.enum(['mm', 'cm', 'm', 'in', 'ft']) }).strict(),
  z.object({ ...factBase, kind: z.literal('capacity'), value: z.number().finite().positive(), unit: z.enum(['ml', 'l', 'fl_oz']) }).strict(),
  z.object({ ...factBase, kind: z.literal('weight'), value: z.number().finite().positive(), unit: z.enum(['g', 'kg', 'lb', 'oz']) }).strict(),
  z.object({ ...factBase, kind: z.literal('load_capacity'), value: z.number().finite().positive(), unit: z.enum(['g', 'kg', 'lb']) }).strict(),
  z.object({ ...factBase, kind: z.literal('material'), value: z.string().trim().min(1).max(200) }).strict(),
  z.object({ ...factBase, kind: z.literal('feature'), value: z.string().trim().min(1).max(200) }).strict(),
])
export const suiteFactsSchema = z.array(suiteFactSchema).max(SUITE_LIMITS.facts)
  .refine(facts => unique(facts.map(fact => fact.id)), '事实 ID 不能重复')
  .refine(facts => unique(facts.filter(fact => fact.kind === 'dimension').map(fact => `${fact.subject}:${fact.axis}`)), '同一测量对象的尺寸方向存在冲突')
const confirmedFacts = suiteFactsSchema.refine(facts => facts.every(fact => fact.confirmed), '快照只能包含已确认事实')

export const suiteSlotConfigSchema = z.object({
  id, key: z.enum(SUITE_SLOT_KEYS), kind: z.enum(SUITE_SLOT_KINDS), name: label,
  order: z.number().int().min(0).max(6), enabled: z.boolean(),
  referenceAssetIds: z.array(id).max(4).refine(unique, '参考图不能重复'),
}).strict()
export const suiteProjectConfigSchema = z.object({
  schemaVersion: z.literal(SUITE_CONTRACT_VERSION), title: label, sku: z.string().trim().min(1).max(100).optional(),
  category: z.literal('home-kitchen'), subcategory: z.enum(SUITE_SUBCATEGORIES),
  platform: z.enum(['amazon', 'general']), marketplace: z.literal('US').optional(),
  ruleProfile: z.object({ id: label, version: label }).strict(), baseAssetId: id,
  tags: suiteTagsSchema, facts: suiteFactsSchema,
  copyLanguage: z.enum(['zh-CN', 'en-US']), unitSystem: z.enum(['metric', 'imperial']),
  style: z.object({ palette: z.array(color).min(1).max(5), sceneTone: label, templateId: label, templateVersion: label }).strict(),
  slots: z.array(suiteSlotConfigSchema).length(SUITE_LIMITS.slots),
}).strict().superRefine((project, ctx) => {
  if (project.platform === 'amazon' ? project.marketplace !== 'US' : project.marketplace !== undefined)
    ctx.addIssue({ code: 'custom', path: ['marketplace'], message: 'Amazon 首期必须指定美国站，通用模板不指定站点' })
  for (const key of ['id', 'key', 'order'] as const) {
    if (!unique(project.slots.map(slot => slot[key]))) ctx.addIssue({ code: 'custom', path: ['slots'], message: `槽位 ${key} 不能重复` })
  }
  const main = project.slots.filter(slot => slot.kind === 'main')
  if (main.length !== 1 || main[0].key !== 'main' || (project.platform === 'amazon' && !main[0].enabled))
    ctx.addIssue({ code: 'custom', path: ['slots'], message: '必须有唯一主图，Amazon 主图不能跳过' })
  if (!project.slots.some(slot => slot.enabled)) ctx.addIssue({ code: 'custom', path: ['slots'], message: '至少启用一个槽位' })
})
export const suiteCreateProjectRequestSchema = z.object({ requestId: id, config: suiteProjectConfigSchema }).strict()
export const suiteUpdateProjectRequestSchema = z.object({ expectedRevision: revision, config: suiteProjectConfigSchema }).strict()
export const suiteProjectSchema = z.object({
  id, actor: suiteActorSchema, revision, config: suiteProjectConfigSchema,
  slotHeads: z.array(z.object({ slotId: id, activeVersionId: id.nullable(), headRevision: revision }).strict()).length(SUITE_LIMITS.slots),
  createdAt: instant, updatedAt: instant, deletedAt: instant.nullable(),
}).strict().superRefine((project, ctx) => {
  const heads = project.slotHeads.map(head => head.slotId)
  if (!unique(heads) || !project.config.slots.every(slot => heads.includes(slot.id)))
    ctx.addIssue({ code: 'custom', path: ['slotHeads'], message: '当前版本指针必须覆盖本项目全部槽位且无重复' })
})

export const suiteAssetSchema = z.object({
  assetId: id, projectId: id, actor: suiteActorSchema,
  objectKey: z.string().min(1).max(512).refine(value => !value.startsWith('temporary/') && !value.includes('://') && !value.includes('?') && !value.split('/').includes('..'), '只能保存持久对象键'),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), size,
  bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), checksum,
}).strict()
export const suiteUploadRequestSchema = z.object({
  requestId: id, name: z.string().trim().min(1).max(200),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']), bytes: z.number().int().positive().max(SUITE_LIMITS.uploadBytes),
}).strict()
export const suiteUploadCompleteRequestSchema = z.object({ assetId: id, uploadId: id }).strict()
export const suiteAssetAccessRequestSchema = z.object({ assetIds: z.array(id).min(1).max(100).refine(unique, '资产不能重复') }).strict()

const point = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict()
export const suiteLayerSchema = z.discriminatedUnion('type', [
  z.object({
    id, type: z.literal('text'), text: z.string().max(SUITE_LIMITS.textLength),
    position: point, width: z.number().finite().positive().max(1),
    fontFamily: z.enum(['Noto Sans SC', 'Noto Sans']), fontSize: z.number().finite().positive().max(1000),
    fontWeight: z.union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)]),
    color, background: z.union([color, z.literal('transparent')]), align: z.enum(['left', 'center', 'right']),
    zIndex: z.number().int().nonnegative().max(SUITE_LIMITS.layers - 1),
  }).strict(),
  z.object({
    id, type: z.literal('dimension'), factId: id, start: point, end: point, labelPosition: point,
    color, strokeWidth: z.number().finite().positive().max(100), fontSize: z.number().finite().positive().max(1000),
    zIndex: z.number().int().nonnegative().max(SUITE_LIMITS.layers - 1),
  }).strict(),
])
const layers = z.array(suiteLayerSchema).max(SUITE_LIMITS.layers).refine(items => unique(items.map(item => item.id)), '图层 ID 不能重复')
export const suiteCompositionSchema = z.object({
  renderSize: size, layersSnapshot: layers, factsSnapshot: confirmedFacts,
  copyLanguage: z.enum(['zh-CN', 'en-US']), unitSystem: z.enum(['metric', 'imperial']),
  templateVersion: label, rendererVersion: label,
}).strict().superRefine((snapshot, ctx) => {
  for (const [index, layer] of snapshot.layersSnapshot.entries()) {
    if (layer.type === 'text' && !layer.text.trim())
      ctx.addIssue({ code: 'custom', path: ['layersSnapshot', index, 'text'], message: '成品文字不能为空，空文字可暂存在编辑草稿' })
    if (layer.type === 'dimension' && !snapshot.factsSnapshot.some(fact => fact.id === layer.factId && typeof fact.value === 'number'))
      ctx.addIssue({ code: 'custom', path: ['layersSnapshot', index, 'factId'], message: '标注必须引用本版本已确认数值规格' })
    if (layer.type === 'dimension' && layer.start.x === layer.end.x && layer.start.y === layer.end.y)
      ctx.addIssue({ code: 'custom', path: ['layersSnapshot', index], message: '标注线不能退化为一点' })
  }
})
export const suiteTaskResultSchema = z.object({
  sourceKind: z.enum(['image_job', 'sync_credit']), sourceId: id, ordinal: z.number().int().min(0).max(3),
}).strict().refine(result => result.sourceKind !== 'sync_credit' || result.ordinal === 0, '同步工具结果序号只能为 0')
export const suiteVersionSchema = z.object({
  id, projectId: id, slotId: id, versionNumber: z.number().int().positive(), parentVersionId: id.nullable(), assetId: id,
  source: z.enum(['reuse', 'generated', 'annotation_edit', 'workstation_return']),
  sourceTask: suiteTaskResultSchema.optional(), sourceRequestId: id.optional(),
  sourceTool: z.enum(['repaint', 'smart-edit', 'retouch', 'relight']).optional(),
  modelProfileId: label.optional(), resolution: z.enum(['1k', '2k', '4k']).optional(),
  promptSnapshot: z.string().max(PROMPT_MAX_LENGTH).optional(), composition: suiteCompositionSchema, createdAt: instant,
}).strict().superRefine((version, ctx) => {
  if (['generated', 'workstation_return'].includes(version.source) && (!version.sourceTask || !version.sourceRequestId))
    ctx.addIssue({ code: 'custom', path: ['sourceTask'], message: '收费生成或工作站回填必须保留原结果与请求身份' })
  if (version.source === 'workstation_return' && !version.sourceTool)
    ctx.addIssue({ code: 'custom', path: ['sourceTool'], message: '回填必须保存真实工具' })
  if (version.source === 'generated' && (version.sourceTask?.sourceKind !== 'image_job' || !version.modelProfileId || !version.resolution || !version.promptSnapshot))
    ctx.addIssue({ code: 'custom', path: ['modelProfileId'], message: '生成版本必须保留真实图片任务、模型、规格与提示词' })
  if (['reuse', 'annotation_edit'].includes(version.source) && (version.modelProfileId || version.resolution || version.sourceTask || version.sourceRequestId || version.sourceTool))
    ctx.addIssue({ code: 'custom', message: '复用或图层编辑通过父版本保留来源，不能伪造新的模型或收费任务' })
})
export const suiteSaveVersionRequestSchema = z.object({
  requestId: id, baseVersionId: id, expectedHeadRevision: revision, composition: suiteCompositionSchema,
}).strict()
export const suiteSetCurrentRequestSchema = z.object({ versionId: id, expectedHeadRevision: revision }).strict()
export const suiteSaveDraftRequestSchema = z.object({
  expectedDraftRevision: revision, baseVersionId: id.nullable(),
  promptNote: z.string().max(PROMPT_MAX_LENGTH), count: z.number().int().min(1).max(4),
  resolution: z.enum(['1k', '2k', '4k']), modelProfileId: label.nullable(), layers,
}).strict()

const selection = z.discriminatedUnion('mode', [
  z.object({ slotId: id, mode: z.literal('reuse') }).strict(),
  z.object({ slotId: id, mode: z.literal('image_edit'), modelProfileId: label, resolution: z.enum(['1k', '2k', '4k']), count: z.number().int().min(1).max(4), note: z.string().trim().max(PROMPT_MAX_LENGTH) }).strict(),
])
export const suiteQuoteRequestSchema = z.object({ expectedRevision: revision, slots: z.array(selection).min(1).max(SUITE_LIMITS.slots) }).strict()
  .refine(request => unique(request.slots.map(slot => slot.slotId)), '不能重复报价同一槽位')
const quoteItemBase = { operationId: id, slotId: id, slotKind: z.enum(SUITE_SLOT_KINDS), sourceAssetId: id }
export const suiteQuoteItemSchema = z.discriminatedUnion('mode', [
  z.object({ ...quoteItemBase, mode: z.literal('reuse'), count: z.literal(1), credits: z.literal(0) }).strict(),
  z.object({
    ...quoteItemBase, mode: z.literal('image_edit'), modelProfileId: label, resolution: z.enum(['1k', '2k', '4k']),
    count: z.number().int().min(1).max(4), unitCredits: credits.refine(value => value > 0, '模型单价必须大于零'), credits,
    size, promptSnapshot: z.string().trim().min(1).max(PROMPT_MAX_LENGTH),
    referenceAssetIds: z.array(id).max(4).refine(unique, '参考图不能重复'), factsSnapshot: confirmedFacts,
    warnings: z.array(z.string().max(500)).max(20).optional(),
  }).strict(),
])
export const suiteQuoteSchema = z.object({
  id, projectId: id, expectedRevision: revision, planFingerprint: checksum,
  items: z.array(suiteQuoteItemSchema).min(1).max(SUITE_LIMITS.slots), totalCredits: credits,
  createdAt: instant, expiresAt: instant,
}).strict().superRefine((quote, ctx) => {
  if (!unique(quote.items.map(item => item.slotId)) || !unique(quote.items.map(item => item.operationId)))
    ctx.addIssue({ code: 'custom', path: ['items'], message: '报价槽位或操作 ID 不能重复' })
  for (const [index, item] of quote.items.entries()) {
    if (item.mode === 'image_edit' && (item.credits !== item.count * item.unitCredits || !Number.isSafeInteger(item.count * item.unitCredits)))
      ctx.addIssue({ code: 'custom', path: ['items', index, 'credits'], message: '候选数量与模型费用不一致' })
    if (item.mode === 'image_edit' && ['main', 'size'].includes(item.slotKind))
      ctx.addIssue({ code: 'custom', path: ['items', index], message: '主图与尺寸默认使用复用路径，AI 编辑走工作站' })
  }
  const total = quote.items.reduce((sum, item) => sum + item.credits, 0)
  if (!Number.isSafeInteger(total) || total !== quote.totalCredits) ctx.addIssue({ code: 'custom', path: ['totalCredits'], message: '报价合计不一致' })
  if (Date.parse(quote.expiresAt) - Date.parse(quote.createdAt) !== SUITE_LIMITS.quoteTtlMs)
    ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: '报价有效期必须为十分钟' })
})
export const suiteCreateBatchRequestSchema = z.object({
  requestId: id, quoteId: id, expectedRevision: revision, planFingerprint: checksum, maxCredits: credits,
}).strict()
export const suiteBatchSchema = z.object({
  id, actor: suiteActorSchema, projectId: id, requestId: id, quoteId: id, planFingerprint: checksum,
  configSnapshot: suiteProjectConfigSchema, state: z.enum(SUITE_BATCH_STATES), maxCredits: credits,
  operationIds: z.array(id).min(1).max(SUITE_LIMITS.slots).refine(unique, '操作不能重复'),
  createdAt: instant, dispatchDeadlineAt: instant, completedAt: instant.nullable(), blockedReason: label.nullable(),
}).strict().refine(batch => Date.parse(batch.dispatchDeadlineAt) - Date.parse(batch.createdAt) === SUITE_LIMITS.dispatchWindowMs, '派发窗口必须为三十分钟')
export const suiteOperationSchema = z.object({
  id, actor: suiteActorSchema, projectId: id, batchId: id, slotId: id, requestId: id,
  mode: z.enum(['reuse', 'image_edit']), phase: z.enum(SUITE_OPERATION_PHASES), expectedHeadRevision: revision,
  task: z.object({ sourceKind: z.literal('image_job'), sourceId: id, requestId: id }).strict().nullable(),
  terminalState: z.enum(['succeeded', 'failed', 'expired', 'cancelled']).nullable(),
  appliedVersionIds: z.array(id).max(4).refine(unique, '同操作版本不能重复'),
  createdAt: instant, updatedAt: instant,
}).strict().superRefine((operation, ctx) => {
  if (operation.phase === 'stopped' && operation.task)
    ctx.addIssue({ code: 'custom', path: ['phase'], message: '已绑定原任务不能被批次停止改写' })
  if (operation.mode === 'reuse' && operation.task)
    ctx.addIssue({ code: 'custom', path: ['task'], message: '复用步骤不能创建收费原任务' })
  if (operation.mode === 'image_edit' && (operation.phase === 'bound' || operation.terminalState) && (!operation.task || operation.task.requestId !== operation.requestId))
    ctx.addIssue({ code: 'custom', path: ['task'], message: '原任务必须与操作的稳定请求号一致' })
})
/** 仅供后续来源适配，阶段一不扩大现有 taskOriginSchema 接受范围。 */
export const suiteOriginSchema = z.object({
  entry: z.literal('ecommerce'), tool: z.literal('ecommerce-suite'), projectId: id, slotId: id, batchId: id, operationId: id,
}).strict()
export const suiteCreateBridgeRequestSchema = z.object({
  slotId: id, sourceVersionId: id, expectedHeadRevision: revision,
  tool: z.enum(['repaint', 'smart-edit', 'retouch', 'relight']), inputMode: z.enum(['base', 'composite']),
}).strict()
export const suiteBridgeResultRequestSchema = z.object({ requestId: id, result: suiteTaskResultSchema }).strict()
export const suiteBridgeSchema = z.object({
  id, actor: suiteActorSchema, projectId: id, slotId: id, sourceVersionId: id, sourceAssetId: id,
  sourceHeadRevision: revision, tool: z.enum(['repaint', 'smart-edit', 'retouch', 'relight']), inputMode: z.enum(['base', 'composite']),
  createdAt: instant, expiresAt: instant,
}).strict().refine(bridge => Date.parse(bridge.expiresAt) - Date.parse(bridge.createdAt) === SUITE_LIMITS.bridgeTtlMs, '桥接会话有效期必须为七天')
export const suiteExportConfigSchema = z.object({
  platform: z.enum(['amazon', 'general']), width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000),
  format: z.enum(['jpeg', 'png', 'webp']), background: z.union([color, z.literal('transparent')]),
  jpegQuality: z.number().finite().min(0.1).max(1).optional(),
}).strict().superRefine((output, ctx) => {
  if (output.platform === 'amazon' && output.format === 'webp') ctx.addIssue({ code: 'custom', path: ['format'], message: 'Amazon 预设不支持 WebP' })
  if (output.format === 'jpeg' && output.background === 'transparent') ctx.addIssue({ code: 'custom', path: ['background'], message: 'JPEG 必须明确铺底色' })
})
export const suitePrecheckRequestSchema = z.object({ versionIds: z.array(id).min(1).max(SUITE_LIMITS.slots).refine(unique, '版本不能重复'), output: suiteExportConfigSchema }).strict()

export type SuiteActor = z.infer<typeof suiteActorSchema>
export type SuiteFact = z.infer<typeof suiteFactSchema>
export type SuiteSlotConfig = z.infer<typeof suiteSlotConfigSchema>
export type SuiteProjectConfig = z.infer<typeof suiteProjectConfigSchema>
export type SuiteProject = z.infer<typeof suiteProjectSchema>
export type SuiteAssetRef = z.infer<typeof suiteAssetSchema>
export type SuiteLayer = z.infer<typeof suiteLayerSchema>
export type SuiteSlotVersion = z.infer<typeof suiteVersionSchema>
export type SuiteQuote = z.infer<typeof suiteQuoteSchema>
export type SuiteSubcategory = (typeof SUITE_SUBCATEGORIES)[number]
export type SuiteBatchState = (typeof SUITE_BATCH_STATES)[number]
export type SuiteBatch = z.infer<typeof suiteBatchSchema>
export type SuiteOperation = z.infer<typeof suiteOperationSchema>
export type SuiteBridge = z.infer<typeof suiteBridgeSchema>
export type SuiteQuoteRequest = z.infer<typeof suiteQuoteRequestSchema>
export type SuiteCreateBatchRequest = z.infer<typeof suiteCreateBatchRequestSchema>
export type SuiteSlotDraft = z.infer<typeof suiteSaveDraftRequestSchema>
export type SuiteTaskResult = z.infer<typeof suiteTaskResultSchema>
