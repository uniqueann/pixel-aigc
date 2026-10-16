import { randomUUID } from 'node:crypto'
import type { Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { createSqlBilling } from '../image-jobs/billing.js'
import { createSqlStore } from '../image-jobs/repository.js'
import { sqlImageExecution } from '../image-jobs/execution.js'
import { advanceImageClaim, boundedImageRuntime, createImageJobInStore, createImageTaskSchema, defaultImageJobRuntime, type ImageJobRuntime } from '../image-jobs/service.js'
import { configuredImageModels } from '../image-providers/registry.js'
import { SUITE_CATEGORY_TEMPLATES } from '../../shared/ecommerce-suite-templates.js'
import { SUITE_SINGLE_SLOT_ONLY } from '../../shared/ecommerce-suite-runtime.js'
import { SUITE_LIMITS, suiteBatchSchema, suiteCreateBatchRequestSchema, suiteOperationSchema, suiteQuoteRequestSchema, suiteQuoteSchema,
  type SuiteBatch, type SuiteProject, type SuiteQuote, type SuiteQuoteRequest } from '../../shared/ecommerce-suite.js'
import { actor, assertRevision, fingerprint, readSuite, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'

/** 报价与接受共用纯映射；期间目录或规格有变化就要求重新确认。 */
async function plan(sql: Transaction, project: SuiteProject, request: SuiteQuoteRequest, runtime: ImageJobRuntime, operationId: string = randomUUID()) {
  assertRevision(project.revision, request.expectedRevision)
  if (request.slots.length !== 1) throw new HttpError(400, SUITE_SINGLE_SLOT_ONLY, 'SUITE_SINGLE_SLOT_ONLY')
  const selection = request.slots[0]
  const slot = project.config.slots.find(slot => slot.id === selection.slotId && slot.enabled)
  if (!slot) throw new HttpError(400, '槽位不存在或已跳过', 'INVALID_REQUEST')
  const template = SUITE_CATEGORY_TEMPLATES[project.config.subcategory].slots.find(item => item.key === slot.key)!
  const facts = project.config.facts.filter(fact => fact.confirmed)
  if (template.requires.includes('confirmed_facts' as never) && !facts.length)
    throw new HttpError(409, '请先补充并确认本槽位的商品事实', 'SUITE_FACTS_REQUIRED')
  if (slot.kind === 'size') throw new HttpError(501, '尺寸标注将在图层编辑阶段接入，当前可先保存商品规格', 'CAPABILITY_UNAVAILABLE')
  const sourceId = template.strategy === 'detail_reference' ? slot.referenceAssetIds[0] : project.config.baseAssetId
  if (!sourceId) throw new HttpError(409, '请先上传该槽位的真实细节照片', 'SUITE_ASSET_UNAVAILABLE')
  const source = await readyAsset(sql, project.id, sourceId)
  if (template.strategy !== 'image_edit') {
    if (selection.mode !== 'reuse') throw new HttpError(400, '该槽位使用原图，不默认重造商品', 'INVALID_REQUEST')
    const item = { operationId, slotId: slot.id, slotKind: slot.kind, sourceAssetId: sourceId, mode: 'reuse' as const, count: 1 as const, credits: 0 as const }
    return { item, execution: null }
  }
  if (selection.mode !== 'image_edit') throw new HttpError(400, '场景槽位需要单独确认图片生成费用', 'INVALID_REQUEST')
  const profile = configuredImageModels('image_edit').find(item => item.id === selection.modelProfileId)
  if (!profile || !profile.ui.resolutions.includes(selection.resolution)) throw new HttpError(409, '模型或分辨率已不可用，请重新选择', 'SUITE_QUOTE_CHANGED')
  if (selection.count > profile.ui.maxCount) throw new HttpError(400, `当前模型最多支持 ${profile.ui.maxCount} 张候选`, 'INVALID_PARAMS')
  const provider = runtime.providerFor(profile.provider)
  if (!provider) throw new HttpError(503, '图片生成服务暂不可用', 'IMAGE_EDIT_UNAVAILABLE')
  if (slot.referenceAssetIds.length > 1) throw new HttpError(400, '当前单槽位入口最多使用一张场景参考图', 'INVALID_PARAMS')
  const reference = slot.referenceAssetIds[0] ? await readyAsset(sql, project.id, slot.referenceAssetIds[0]) : null
  if (reference?.assetId === source.assetId || (reference && profile.ui.maxRefImages < 2)) throw new HttpError(400, '参考图重复或超过模型能力', 'INVALID_PARAMS')
  const styleTags = project.config.tags.filter(tag => SUITE_CATEGORY_TEMPLATES[project.config.subcategory].styleTags.some(style => style === tag))
  const prompt = [
    `为商品「${project.config.title}」制作${slot.name}。以主体照片为商品身份参考，保留外观、颜色、标识和配件数量，禁止补造内部结构。`,
    `风格：${project.config.style.sceneTone}；配色 ${project.config.style.palette.join('、')}；${styleTags.join('、')}。`,
    facts.length ? `用户已确认事实：${facts.map(fact => `${fact.name}：${fact.value}${'unit' in fact ? fact.unit : ''}`).join('；')}。` : '',
    '画面不要添加文字、数字、角标或水印；文案由后续独立图层编辑。', selection.note,
  ].filter(Boolean).join('\n')
  if (prompt.length > (profile.ui.promptMaxLength ?? 4000)) throw new HttpError(400, '商品资料与编辑要求合并后过长，请缩短要求', 'INVALID_PARAMS')
  const mapped = provider.mapRequest({ operation: 'image_edit', prompt,
    images: [source, ...(reference ? [reference] : [])].map(asset => ({ source: { kind: 'r2' as const, objectKey: asset.objectKey }, ...asset.size })),
    target: { resolution: selection.resolution }, count: selection.count }, profile.model)
  const resolution = mapped.providerParams.resolution
  if (!['1k', '2k', '4k'].includes(String(resolution)) || mapped.fanOut !== selection.count)
    throw new HttpError(409, '模型返回了不兼容的生成规格', 'SUITE_QUOTE_CHANGED')
  const tier = resolution as '1k' | '2k' | '4k'
  const unit = profile.pricing.creditsPerImage[tier]
  if (!unit || !Number.isSafeInteger(unit) || unit < 1) throw new HttpError(503, '模型积分单价不可用', 'IMAGE_PRICE_UNAVAILABLE')
  const pixels = typeof mapped.providerParams.size === 'string' ? /^(\d+)[x*](\d+)$/.exec(mapped.providerParams.size) : null
  const longEdge = ({ '1k': 1024, '2k': 2048, '4k': 4096 })[tier]
  const aspect = mapped.expectedAspect ?? source.size.width / source.size.height
  const size = pixels ? { width: Number(pixels[1]), height: Number(pixels[2]) }
    : { width: Math.max(1, Math.round(longEdge * Math.min(1, aspect))), height: Math.max(1, Math.round(longEdge / Math.max(1, aspect))) }
  const item = { operationId, slotId: slot.id, slotKind: slot.kind, sourceAssetId: sourceId, mode: 'image_edit' as const,
    modelProfileId: profile.id, resolution: tier, count: selection.count, unitCredits: unit, credits: unit * selection.count,
    size, promptSnapshot: prompt, referenceAssetIds: reference ? [reference.assetId] : [], factsSnapshot: facts, warnings: mapped.warnings }
  return { item, execution: { provider: profile.provider, mapped: mapped.providerParams,
    params: { sourceImageKey: source.objectKey, sourceWidth: source.size.width, sourceHeight: source.size.height,
      ...(reference ? { referenceImageKey: reference.objectKey } : {}), prompt, resolution: selection.resolution, count: selection.count } } }
}
export function quoteSuite(user: SuiteUser, projectId: string, body: unknown, runtime = defaultImageJobRuntime()) {
  const request = suiteQuoteRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const project = await readSuite(sql, projectId)
    const planned = await plan(sql, project, request, runtime)
    const nowMs = runtime.now(), now = new Date(nowMs).toISOString()
    const quote = suiteQuoteSchema.parse({ id: randomUUID(), projectId, expectedRevision: project.revision,
      planFingerprint: fingerprint({ config: project.config, ...planned }), items: [planned.item], totalCredits: planned.item.credits,
      createdAt: now, expiresAt: new Date(nowMs + SUITE_LIMITS.quoteTtlMs).toISOString() })
    await sql`insert into aigc.suite_quotes(id,user_id,scope,project_id,snapshot,request,expires_at)
      values(${quote.id},${user.id},${actor(user).runtimeScope},${projectId},${sql.json(quote as never)},${sql.json(request as never)},${quote.expiresAt})`
    return quote
  })
}
export async function createSuiteBatch(user: SuiteUser, projectId: string, body: unknown, runtime = defaultImageJobRuntime()) {
  const request = suiteCreateBatchRequestSchema.parse(body)
  const bounded = boundedImageRuntime({ ...runtime, execution: sqlImageExecution(user.id, user.email), allowSubmit: true }, 110_000)
  const created = await suiteTransaction(user, async sql => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`suite-batch:${user.id}:${actor(user).runtimeScope}:${request.requestId}`},0))`
    await requireSuite(sql, projectId, true)
    const [old] = await sql`select * from aigc.suite_batches where request_id=${request.requestId}`
    if (old) {
      if (old.project_id !== projectId || old.request_fingerprint !== fingerprint(request)) throw new HttpError(409, '原请求已用于其他生成计划', 'SUITE_REQUEST_CONFLICT')
      return { batch: suiteBatchSchema.parse(old.snapshot), image: null }
    }
    const project = await readSuite(sql, projectId)
    assertRevision(project.revision, request.expectedRevision)
    const [row] = await sql`select * from aigc.suite_quotes where project_id=${projectId} and id=${request.quoteId} for update`
    if (!row) throw new HttpError(404, '报价不存在或无权访问', 'SUITE_QUOTE_CHANGED')
    const quote = suiteQuoteSchema.parse(row.snapshot)
    if (row.accepted_batch_id) throw new HttpError(409, '该报价已被接受，请找回原批次', 'SUITE_REQUEST_CONFLICT')
    if (Date.parse(quote.expiresAt) <= runtime.now()) throw new HttpError(409, '报价已过期，请重新确认', 'SUITE_QUOTE_EXPIRED')
    const planned = await plan(sql, project, suiteQuoteRequestSchema.parse(row.request), runtime, quote.items[0].operationId)
    if (quote.planFingerprint !== request.planFingerprint || fingerprint({ config: project.config, ...planned }) !== quote.planFingerprint
      || quote.expectedRevision !== request.expectedRevision || request.maxCredits !== quote.totalCredits)
      throw new HttpError(409, '模型、价格或资料已变化，请重新报价', 'SUITE_QUOTE_CHANGED')
    if ((await sql`select 1 from aigc.suite_batches where project_id=${projectId} and state in ('queued','running','blocked')`).length)
      throw new HttpError(409, '本项目仍有待收口任务，请先读取原结果', 'SUITE_BATCH_ACTIVE')
    const id = randomUUID(), item = quote.items[0]
    const nowMs = runtime.now(), now = new Date(nowMs).toISOString()
    const [slot] = await sql`select head_revision from aigc.suite_slots where id=${item.slotId} and project_id=${projectId} for update`
    const batch: SuiteBatch = { id, actor: actor(user), projectId, requestId: request.requestId, quoteId: quote.id,
      planFingerprint: quote.planFingerprint, configSnapshot: project.config, state: 'running', maxCredits: request.maxCredits,
      operationIds: [item.operationId], createdAt: now, dispatchDeadlineAt: new Date(nowMs + SUITE_LIMITS.dispatchWindowMs).toISOString(), completedAt: null, blockedReason: null }
    let operation = suiteOperationSchema.parse({ id: item.operationId, actor: actor(user), projectId, batchId: id, slotId: item.slotId,
      requestId: randomUUID(), mode: item.mode, phase: 'dispatching', expectedHeadRevision: slot.head_revision,
      task: null, terminalState: null, appliedVersionIds: [], createdAt: now, updatedAt: now })
    await sql`insert into aigc.suite_batches(id,user_id,scope,project_id,request_id,request_fingerprint,quote_id,state,snapshot)
      values(${id},${user.id},${actor(user).runtimeScope},${projectId},${request.requestId},${fingerprint(request)},${quote.id},'running',${sql.json(batch as never)})`
    await sql`insert into aigc.suite_operations(id,user_id,scope,project_id,batch_id,slot_id,request_id,snapshot)
      values(${operation.id},${user.id},${actor(user).runtimeScope},${projectId},${id},${item.slotId},${operation.requestId},${sql.json(operation as never)})`
    let image = null
    if (planned.execution && item.mode === 'image_edit') {
      // 与原预扣、job、items 和操作绑定同事务提交，网络 I/O 在提交后执行。
      await sql`select pg_advisory_xact_lock(91517002)`
      const parsed = createImageTaskSchema.parse({ requestId: operation.requestId, capability: 'image_edit', modelProfileId: item.modelProfileId,
        origin: { entry: 'ecommerce', tool: 'ecommerce-suite', projectId, slotId: item.slotId, batchId: id, operationId: operation.id }, params: planned.execution.params })
      const original = await createImageJobInStore(createSqlStore(sql, user.id), user, parsed, { ...bounded, billing: createSqlBilling(sql) })
      if (original.bundle.job.credits_reserved !== quote.totalCredits || original.bundle.job.provider !== planned.execution.provider)
        throw new HttpError(409, '实际任务费用或渠道与报价不一致，请重新确认', 'SUITE_QUOTE_CHANGED')
      image = original.created ? original.bundle : null
      operation = { ...operation, phase: 'bound', task: { sourceKind: 'image_job', sourceId: original.bundle.job.id, requestId: operation.requestId } }
      await sql`update aigc.suite_operations set source_job_id=${original.bundle.job.id},snapshot=${sql.json(operation as never)} where id=${operation.id}`
    }
    await sql`update aigc.suite_quotes set accepted_batch_id=${id} where id=${quote.id}`
    return { batch, image }
  })
  if (created.image) await advanceImageClaim(created.image, bounded, true)
  return created.batch
}
export function findSuiteBatch(user: SuiteUser, projectId: string, requestId: string) {
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    const [row] = await sql`select snapshot from aigc.suite_batches where project_id=${projectId} and request_id=${requestId}`
    return row ? suiteBatchSchema.parse(row.snapshot) : null
  })
}
export type { SuiteQuote }
