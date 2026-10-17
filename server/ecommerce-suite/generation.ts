import { randomUUID } from 'node:crypto'
import type { Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { createImageTaskSchema, defaultImageJobRuntime, type ImageJobRuntime } from '../image-jobs/service.js'
import { configuredImageModels } from '../image-providers/registry.js'
import { composeFusionPrompt } from '../../shared/fusion.js'
import { SUITE_CATEGORY_TEMPLATES } from '../../shared/ecommerce-suite-templates.js'
import { suiteOperationRetryable } from '../../shared/ecommerce-suite-state.js'
import { stopUnsubmittedOperations } from './batches.js'
import { SUITE_LIMITS, suiteBatchSchema, suiteCreateBatchRequestSchema, suiteOperationSchema, suiteQuoteRequestSchema, suiteQuoteSchema,
  type SuiteBatch, type SuiteProject, type SuiteQuote, type SuiteQuoteRequest } from '../../shared/ecommerce-suite.js'
import { actor, assertRevision, fingerprint, readSuite, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'

/** 报价与接受共用纯映射；期间目录或规格有变化就要求重新确认。 */
export async function planSuiteSlot(sql: Transaction, project: SuiteProject, selection: SuiteQuoteRequest['slots'][number], runtime: ImageJobRuntime, operationId: string = randomUUID()) {
  const slot = project.config.slots.find(slot => slot.id === selection.slotId && slot.enabled)
  if (!slot) throw new HttpError(400, '槽位不存在或已跳过', 'INVALID_REQUEST')
  const template = SUITE_CATEGORY_TEMPLATES[project.config.subcategory].slots.find(item => item.key === slot.key)!
  const facts = project.config.facts.filter(fact => fact.confirmed)
  if (template.requires.includes('confirmed_facts' as never) && !facts.length)
    throw new HttpError(409, '请先补充并确认本槽位的商品事实', 'SUITE_FACTS_REQUIRED')
  if (slot.kind === 'size' && !facts.some(fact => ['dimension', 'capacity'].includes(fact.kind)))
    throw new HttpError(409, '请先确认尺寸或容量规格，再添加可编辑标注', 'SUITE_FACTS_REQUIRED')
  const sourceId = template.strategy === 'detail_reference' ? slot.referenceAssetIds[0] : slot.kind === 'size' ? slot.referenceAssetIds[0] ?? project.config.baseAssetId : project.config.baseAssetId
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
  const mapped = provider.mapRequest({ operation: 'image_edit', prompt: reference ? composeFusionPrompt(prompt) : prompt,
    images: [{ source: { kind: 'r2' as const, objectKey: source.objectKey }, ...source.size },
      ...(reference ? [{ source: { kind: 'r2' as const, objectKey: reference.objectKey } }] : [])],
    target: { resolution: selection.resolution }, count: selection.count }, profile.model)
  if (reference) mapped.providerParams = { ...mapped.providerParams, prompt: composeFusionPrompt(prompt) }
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
  createImageTaskSchema.parse({ capability: 'image_edit', requestId: operationId, modelProfileId: profile.id,
    params: { sourceImageKey: source.objectKey, sourceWidth: source.size.width, sourceHeight: source.size.height,
      ...(reference ? { referenceImageKey: reference.objectKey } : {}), prompt, resolution: selection.resolution, count: selection.count } })
  return { item, execution: { provider: profile.provider, mapped: mapped.providerParams,
    params: { sourceImageKey: source.objectKey, sourceWidth: source.size.width, sourceHeight: source.size.height,
      ...(reference ? { referenceImageKey: reference.objectKey } : {}), prompt, resolution: selection.resolution, count: selection.count } } }
}
export type SuitePlannedSlot = Awaited<ReturnType<typeof planSuiteSlot>>

async function validateRetry(sql: Transaction, projectId: string, request: SuiteQuoteRequest) {
  if (!request.retryOfBatchId) return new Map<string, string>()
  const [batch] = await sql`select id from aigc.suite_batches where id=${request.retryOfBatchId} and project_id=${projectId} for update`
  if (!batch) throw new HttpError(404, '待重试批次不存在', 'SUITE_NOT_FOUND')
  const operations = (await sql`select snapshot from aigc.suite_operations where batch_id=${batch.id} order by id for update`).map(row => suiteOperationSchema.parse(row.snapshot))
  if (operations.some(op => op.task && !op.terminalState || op.phase === 'confirming'))
    throw new HttpError(409, '原任务尚未收口，不能换新编号绕过确认', 'SUITE_BATCH_ACTIVE')
  const selected = request.slots.map(slot => operations.find(op => op.slotId === slot.slotId))
  if (selected.some(op => !op || !suiteOperationRetryable(op)))
    throw new HttpError(409, '重试只能选择未执行或失败且没有成功候选的槽位', 'SUITE_RETRY_INVALID')
  const parents = selected.map(op => op!.id)
  if ((await sql`select 1 from aigc.suite_operations where project_id=${projectId} and snapshot->>'retryOfOperationId' in ${sql(parents)} limit 1`).length)
    throw new HttpError(409, '所选项已有后续尝试，请查看最新批次；旧失败不能绕过新结果再次重试', 'SUITE_RETRY_INVALID')
  return new Map(selected.map(op => [op!.slotId, op!.id]))
}

export function quoteSuite(user: SuiteUser, projectId: string, body: unknown, runtime = defaultImageJobRuntime()) {
  const request = suiteQuoteRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const project = await readSuite(sql, projectId)
    assertRevision(project.revision, request.expectedRevision)
    await validateRetry(sql, projectId, request)
    const planned: SuitePlannedSlot[] = []
    for (const selection of request.slots) planned.push(await planSuiteSlot(sql, project, selection, runtime))
    const nowMs = runtime.now(), now = new Date(nowMs).toISOString()
    const quote = suiteQuoteSchema.parse({ id: randomUUID(), projectId, expectedRevision: project.revision,
      planFingerprint: fingerprint({ config: project.config, planned }), items: planned.map(slot => slot.item),
      totalCredits: planned.reduce((sum, slot) => sum + slot.item.credits, 0),
      createdAt: now, expiresAt: new Date(nowMs + SUITE_LIMITS.quoteTtlMs).toISOString() })
    await sql`insert into aigc.suite_quotes(id,user_id,scope,project_id,snapshot,request,expires_at)
      values(${quote.id},${user.id},${actor(user).runtimeScope},${projectId},${sql.json(quote as never)},${sql.json(request as never)},${quote.expiresAt})`
    return quote
  })
}

/** 接受只保存已确认计划，原任务与预扣由维护器在派发事务中创建。 */
export async function createSuiteBatch(user: SuiteUser, projectId: string, body: unknown, runtime = defaultImageJobRuntime()) {
  const request = suiteCreateBatchRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`suite-batch:${user.id}:${actor(user).runtimeScope}:${request.requestId}`},0))`
    await requireSuite(sql, projectId, true)
    const [old] = await sql`select * from aigc.suite_batches where request_id=${request.requestId}`
    if (old) {
      if (old.project_id !== projectId || old.request_fingerprint !== fingerprint(request)) throw new HttpError(409, '原请求已用于其他生成计划', 'SUITE_REQUEST_CONFLICT')
      return suiteBatchSchema.parse(old.snapshot)
    }
    const project = await readSuite(sql, projectId)
    assertRevision(project.revision, request.expectedRevision)
    const [row] = await sql`select * from aigc.suite_quotes where project_id=${projectId} and id=${request.quoteId} for update`
    if (!row) throw new HttpError(404, '报价不存在或无权访问', 'SUITE_QUOTE_CHANGED')
    const quote = suiteQuoteSchema.parse(row.snapshot)
    if (row.accepted_batch_id) throw new HttpError(409, '该报价已被接受，请找回原批次', 'SUITE_REQUEST_CONFLICT')
    if (Date.parse(quote.expiresAt) <= runtime.now()) throw new HttpError(409, '报价已过期，请重新确认', 'SUITE_QUOTE_EXPIRED')
    const quoteRequest = suiteQuoteRequestSchema.parse(row.request)
    const retry = await validateRetry(sql, projectId, quoteRequest)
    const planned: SuitePlannedSlot[] = []
    for (const [index, selection] of quoteRequest.slots.entries())
      planned.push(await planSuiteSlot(sql, project, selection, runtime, quote.items[index].operationId))
    if (quote.planFingerprint !== request.planFingerprint || fingerprint({ config: project.config, planned }) !== quote.planFingerprint
      || quote.expectedRevision !== request.expectedRevision || request.maxCredits !== quote.totalCredits)
      throw new HttpError(409, '模型、价格或资料已变化，请重新报价', 'SUITE_QUOTE_CHANGED')
    if (quoteRequest.retryOfBatchId) await stopUnsubmittedOperations(sql, quoteRequest.retryOfBatchId, 'RECONFIRMED')
    if ((await sql`select 1 from aigc.suite_batches where project_id=${projectId} and state in ('queued','running','blocked')`).length)
      throw new HttpError(409, '本项目仍有活动批次，请先停止未派发项并等待原任务收口', 'SUITE_BATCH_ACTIVE')
    const id = randomUUID(), nowMs = runtime.now(), now = new Date(nowMs).toISOString()
    const batch: SuiteBatch = { id, actor: actor(user), projectId, requestId: request.requestId, quoteId: quote.id,
      planFingerprint: quote.planFingerprint, configSnapshot: project.config, state: 'queued', maxCredits: request.maxCredits,
      operationIds: quote.items.map(item => item.operationId), createdAt: now,
      dispatchDeadlineAt: new Date(nowMs + SUITE_LIMITS.dispatchWindowMs).toISOString(), completedAt: null, blockedReason: null }
    await sql`insert into aigc.suite_batches(id,user_id,scope,project_id,request_id,request_fingerprint,quote_id,state,snapshot)
      values(${id},${user.id},${actor(user).runtimeScope},${projectId},${request.requestId},${fingerprint(request)},${quote.id},'queued',${sql.json(batch as never)})`
    for (const slotPlan of planned) {
      const item = slotPlan.item
      const [slot] = await sql`select head_revision from aigc.suite_slots where id=${item.slotId} and project_id=${projectId} for update`
      const operation = suiteOperationSchema.parse({ id: item.operationId, actor: actor(user), projectId, batchId: id, slotId: item.slotId,
        requestId: randomUUID(), mode: item.mode, phase: 'waiting', expectedHeadRevision: slot.head_revision,
        ...(retry.has(item.slotId) ? { retryOfOperationId: retry.get(item.slotId) } : {}),
        task: null, terminalState: null, appliedVersionIds: [], createdAt: now, updatedAt: now })
      await sql`insert into aigc.suite_operations(id,user_id,scope,project_id,batch_id,slot_id,request_id,snapshot,plan)
        values(${operation.id},${user.id},${actor(user).runtimeScope},${projectId},${id},${item.slotId},${operation.requestId},${sql.json(operation as never)},${sql.json(slotPlan as never)})`
    }
    await sql`update aigc.suite_quotes set accepted_batch_id=${id} where id=${quote.id}`
    return batch
  })
}
export function findSuiteBatch(user: SuiteUser, projectId: string, requestId: string) {
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    const [row] = await sql`select snapshot from aigc.suite_batches where project_id=${projectId} and request_id=${requestId}`
    return row ? suiteBatchSchema.parse(row.snapshot) : null
  })
}
export type { SuiteQuote }
