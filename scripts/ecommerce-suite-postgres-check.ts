import { HttpError } from '../server/errors.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { bootstrapImageTestDatabase } from '../server/image-jobs/database-fixture.js'
import { database } from '../server/db.js'
import { maintainImageJobs, withImageMaintenance } from '../server/image-jobs/maintenance.js'
import { dispatchSuiteClaim, maintainSuiteBatches, type SuiteClaim } from '../server/ecommerce-suite/maintenance.js'
import { readSuiteBatch, stopSuiteBatch } from '../server/ecommerce-suite/batches.js'
import { queryPort, withTaskCenterRead } from '../server/task-center/service.js'
import { taskRepository } from '../server/task-center/repository.js'
import { sqlImageExecution } from '../server/image-jobs/execution.js'
import { advanceImageClaim } from '../server/image-jobs/service.js'
import { createSuite, findSuiteByRequest, getSuite, listSuites, recycleSuite, selectSuiteVersion, saveSuiteDraft, updateSuite } from '../server/ecommerce-suite/projects.js'
import { precheckSuite } from '../server/ecommerce-suite/precheck.js'
import { cleanupSuiteAssets } from '../server/ecommerce-suite/cleanup.js'
import { beginSuiteObjectWrite } from '../server/ecommerce-suite/object-writes.js'
import { beginSuiteUpload, completeSuiteUpload, suiteObjectKey, type SuiteStorage } from '../server/ecommerce-suite/assets.js'
import { saveSuiteVersion } from '../server/ecommerce-suite/versions.js'
import { createSuiteBridge, readSuiteBridge, returnSuiteBridge } from '../server/ecommerce-suite/bridges.js'
import { restoreSuiteSnapshot } from '../server/ecommerce-suite/restore.js'
import { withSyncCredits } from '../server/sync-billing.js'
import { SYNC_PRICE_VERSION } from '../shared/billing.js'
import { createSuiteBatch, findSuiteBatch, quoteSuite } from '../server/ecommerce-suite/generation.js'
import { registerSuiteOperationResults, registerSuiteResults } from '../server/ecommerce-suite/results.js'
import { createMockImageProvider, MOCK_PNG_1X1 } from '../server/image-providers/mock.js'
import { defaultImageJobRuntime, isSafeObjectKey, loadImageTask, submitImageTask } from '../server/image-jobs/service.js'
import { SUITE_CATEGORY_TEMPLATES, SUITE_TEMPLATE_VERSION } from '../shared/ecommerce-suite-templates.js'
import type { SuiteProjectConfig } from '../shared/ecommerce-suite.js'

const url = process.env.SUITE_TEST_DATABASE_URL
if (!url || process.env.SUITE_TEST_DATABASE_CONFIRM !== 'isolated') throw new Error('请配置空白独立库 SUITE_TEST_DATABASE_URL 并确认 SUITE_TEST_DATABASE_CONFIRM=isolated')
const parsed = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname)) throw new Error('套图验收仅允许本机独立 PostgreSQL')
for (const name of ['AIGC_DATABASE_URL', 'AIGC_ADMIN_DATABASE_URL']) {
  const existing = process.env[name]
  if (existing && new URL(existing).host === parsed.host && new URL(existing).pathname === parsed.pathname) throw new Error('测试不能复用业务数据库')
}
const sql = postgres(url, { max: 2, prepare: false })
const users = [randomUUID(), randomUUID()]
const checks: string[] = []
let runtimeConnected = false
const identity = <T>(owner: string, scope: string, action: (db: postgres.TransactionSql) => Promise<T>) => sql.begin(async tx => {
  await tx`set local role aigc_api`
  await tx`select set_config('aigc.user_id',${owner},true),set_config('aigc.scope',${scope},true)`
  return action(tx)
}) as Promise<T>
try {
  assert.equal((await sql`select exists(select 1 from pg_namespace where nspname in ('aigc','auth')) as occupied`)[0].occupied, false, '独立库必须为空')
  assert.equal((await sql`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','f')) as occupied`)[0].occupied, false, '检测到已有业务表，不能作为独立验收库')
  await bootstrapImageTestDatabase(statement => sql.unsafe(statement), users)
  for (const owner of users) await sql`insert into aigc.credit_accounts(user_id,scope,balance) values(${owner},'local',100)`
  Object.assign(process.env, { AIGC_DATABASE_URL: url, AIGC_DB_LOCAL: 'true', AIGC_RUNTIME_SCOPE: 'local', VERCEL_ENV: 'development', AIGC_IMAGE_MOCK_PROVIDER: 'true', ECOMMERCE_SUITE_ENABLED: 'true', ECOMMERCE_SUITE_MAINTENANCE_ENABLED: 'true', IMAGE_MAINTENANCE_ENABLED: 'true', IMAGE_BACKGROUND_SUBMIT_ENABLED: 'true' })
  runtimeConnected = true
  const user = { id: users[0], email: 'suite-test@example.invalid', suggestedName: '套图验收', avatarUrl: null, providers: ['email'] }
  const other = { ...user, id: users[1] }
  const objects = new Map<string, { bytes: Buffer; contentType: string }>()
  let submissions = 0
  const rejectedTasks = new Set<string>()
  const provider = createMockImageProvider({ submit: async (_input, context) => { submissions++; return { providerTaskId: `mock-${context.now()}-${submissions}` } },
    getStatus: async id => rejectedTasks.has(id)
      ? { state: 'failed', code: 'CONTENT_REJECTED', message: '合成拒绝场景', retryable: false }
      : { state: 'succeeded', resultUrls: [`https://mock.local/${id}.png`] } })
  const storage: SuiteStorage = {
    read: async key => { const found = objects.get(key); if (!found) throw new Error('测试对象缺失'); return found },
    put: async (key, bytes, contentType) => { objects.set(key, { bytes: Buffer.from(bytes), contentType }) },
    signRead: async key => ({ url: `https://storage.example.invalid/${key}`, expiresAt: Date.now() + 900000 }),
    signUpload: async key => key,
  }
  const runtime = { ...defaultImageJobRuntime(), log: () => undefined, providerFor: () => provider,
    getObject: storage.read, putObject: storage.put, signRead: storage.signRead }
  const config: SuiteProjectConfig = { schemaVersion: 1, title: '合成协议样例，不是真实商品', category: 'home-kitchen', subcategory: 'furniture',
    platform: 'general', ruleProfile: { id: 'general', version: 'draft-v1' }, baseAssetId: randomUUID(), tags: ['自然光'], facts: [],
    copyLanguage: 'zh-CN', unitSystem: 'metric', style: { palette: ['#ffffff'], sceneTone: '自然光', templateId: 'furniture', templateVersion: SUITE_TEMPLATE_VERSION },
    slots: SUITE_CATEGORY_TEMPLATES.furniture.slots.map((slot, index) => ({ id: randomUUID(), key: slot.key, kind: slot.kind, name: slot.name, order: index, enabled: true, referenceAssetIds: [] })) }
  const creation = { requestId: randomUUID(), config }
  const project = await createSuite(user, creation)
  assert.equal((await createSuite(user, creation)).id, project.id)
  assert.equal((await findSuiteByRequest(user, creation.requestId))?.id, project.id)
  await assert.rejects(createSuite(user, { ...creation, config: { ...config, title: '不同配置' } }), (error: unknown) => (error as { code: string }).code === 'SUITE_REQUEST_CONFLICT')
  assert.equal((await listSuites(user, 1)).items[0].baseReady, false)
  await assert.rejects(quoteSuite(user, project.id, { expectedRevision: 0, slots: [{ slotId: config.slots[1].id, mode: 'image_edit', modelProfileId: 'mock:image-stage2', resolution: '1k', count: 1, note: '' }] }, runtime), /图片尚未持久保存/)
  checks.push('创建与原请求查找幂等；主体图未就绪不能报价')

  const init = await beginSuiteUpload(user, project.id, { requestId: config.baseAssetId, name: '主体图', mimeType: 'image/png', bytes: MOCK_PNG_1X1.length }, storage)
  assert.ok(init.uploadUrl && init.uploadId)
  objects.set(init.uploadUrl, { bytes: Buffer.from(MOCK_PNG_1X1), contentType: 'image/png' })
  const completed = await completeSuiteUpload(user, project.id, { assetId: config.baseAssetId, uploadId: init.uploadId }, storage)
  assert.equal((await completeSuiteUpload(user, project.id, { assetId: config.baseAssetId, uploadId: init.uploadId }, storage)).asset.checksum, completed.asset.checksum)
  assert.equal(isSafeObjectKey(user.id, completed.asset.objectKey), true)
  assert.equal(isSafeObjectKey(other.id, completed.asset.objectKey), false)
  checks.push('真实 PNG 解码、内容校验与持久对象完成可重入')

  const edited = await updateSuite(user, project.id, { expectedRevision: 0, config: { ...config, title: '已更新商品' } })
  await assert.rejects(updateSuite(user, project.id, { expectedRevision: 0, config }), /云端已有更新/)
  await assert.rejects(getSuite(other, project.id), /不存在或无权/)
  process.env.AIGC_RUNTIME_SCOPE = 'preview'
  await assert.rejects(getSuite(user, project.id), /不存在或无权/)
  assert.equal(isSafeObjectKey(user.id, completed.asset.objectKey), false)
  process.env.AIGC_RUNTIME_SCOPE = 'local'
  for (const [owner, scope] of [[other.id, 'local'], [user.id, 'preview']])
    assert.equal((await identity(owner, scope, tx => tx`select id from aigc.suite_projects where id=${project.id}`)).length, 0)
  await assert.rejects(identity(other.id, 'local', tx => tx`insert into aigc.suite_projects(user_id,scope,create_request_id,request_fingerprint,config) values(${user.id},'local',${randomUUID()},'forged','{}')`), /row-level security/)
  checks.push('实际 aigc_api 角色跨账号、环境读取为空，伪造归属写入拒绝，旧修订返回冲突')

  const mainQuote = await quoteSuite(user, project.id, { expectedRevision: edited.revision, slots: [{ slotId: config.slots[0].id, mode: 'reuse' }] }, runtime)
  assert.equal(mainQuote.totalCredits, 0)
  const acceptQuote = (quote: typeof mainQuote, requestId = randomUUID()) => ({ requestId, quoteId: quote.id, expectedRevision: quote.expectedRevision, planFingerprint: quote.planFingerprint, maxCredits: quote.totalCredits })
  await assert.rejects(createSuiteBatch(user, project.id, { ...acceptQuote(mainQuote), maxCredits: 1 }, runtime), /报价不一致|重新报价|重新确认/)
  await assert.rejects(createSuiteBatch(user, project.id, acceptQuote(mainQuote), { ...runtime, now: () => Date.now() + 601000 }), /报价已过期/)
  await assert.rejects(identity(user.id, 'local', tx => tx`update aigc.suite_quotes set snapshot='{}' where id=${mainQuote.id}`), /permission denied/)
  for (const table of ['suite_projects', 'suite_slots', 'suite_assets', 'suite_versions', 'suite_quotes', 'suite_batches', 'suite_operations']) {
    const [privilege] = await sql`select has_table_privilege('anon',${`aigc.${table}`},'select') as anonymous,has_table_privilege('authenticated',${`aigc.${table}`},'select') as authenticated`
    assert.equal(privilege.anonymous, false); assert.equal(privilege.authenticated, false)
  }
  checks.push('篡改预算与过期报价被拒绝，报价内容不可更新；七张套图表均无 Data API 角色直接读权限')
  const mainBatch = await createSuiteBatch(user, project.id, acceptQuote(mainQuote), runtime)
  await maintainSuiteBatches(runtime, randomUUID(), storage)
  await registerSuiteResults(user, project.id, mainBatch.id, storage)
  await registerSuiteResults(user, project.id, mainBatch.id, storage)
  assert.equal((await sql`select count(*)::int as n from aigc.suite_versions where project_id=${project.id}`)[0].n, 1)
  assert.equal(submissions, 0)
  checks.push('主图复用无供应商调用、无预扣，重复登记只创建一个版本')

  const quoteRequest = { expectedRevision: edited.revision, slots: [{ slotId: config.slots[1].id, mode: 'image_edit' as const, modelProfileId: 'mock:image-stage2', resolution: '1k' as const, count: 2, note: '只改变场景' }] }
  const quote = await quoteSuite(user, project.id, quoteRequest, runtime)
  assert.equal(quote.totalCredits, 2)
  const request = acceptQuote(quote)
  const generated = await createSuiteBatch(user, project.id, request, runtime)
  assert.equal((await createSuiteBatch(user, project.id, request, runtime)).id, generated.id)
  assert.equal((await findSuiteBatch(user, project.id, request.requestId))?.id, generated.id)
  assert.equal(submissions, 0, '接受批次不提交供应商或预扣')
  await maintainSuiteBatches(runtime, randomUUID(), storage)
  assert.equal(submissions, 2)
  const [job] = await sql`select * from aigc.image_jobs where origin->>'batchId'=${generated.id}`
  assert.ok(job)
  assert.equal((await sql`select count(*)::int as n from aigc.credit_ledger where job_id=${job.id} and kind='reserve'`)[0].n, 1)
  const before = submissions
  await getSuite(user, project.id); await findSuiteBatch(user, project.id, request.requestId)
  assert.equal(submissions, before)
  await assert.rejects(submitImageTask(user, { capability: 'image_edit', requestId: randomUUID(), origin: job.origin, modelProfileId: 'mock:image-stage2', params: job.params }, runtime), /报价确认入口/)
  checks.push('原任务、两候选和一次预扣同事务绑定；同请求重放、GET 与原请求查找不重复提交；通用任务入口拒绝伪造套图来源')

  await sql`update aigc.image_jobs set next_poll_at=now()-interval '1 second' where id=${job.id}`
  const task = await loadImageTask(user, job.id, runtime)
  assert.equal(task?.status, 'succeeded')
  await Promise.all([registerSuiteResults(user, project.id, generated.id, storage), registerSuiteResults(user, project.id, generated.id, storage)])
  const detail = await getSuite(user, project.id)
  const generatedVersions = detail.versions.filter(version => version.slotId === config.slots[1].id)
  assert.equal(generatedVersions.length, 2)
  assert.equal(detail.project.slotHeads[1].activeVersionId, null)
  const charged = detail.tasks.find(task => task.sourceId === job.id)!
  assert.equal(charged.creditsCharged, 2)
  assert.equal(charged.billingState, 'settled')
  assert.equal(charged.origin?.entry, 'ecommerce')
  await selectSuiteVersion(user, project.id, config.slots[1].id, { versionId: generatedVersions[0].id, expectedHeadRevision: 0 })
  await assert.rejects(selectSuiteVersion(user, project.id, config.slots[1].id, { versionId: generatedVersions[1].id, expectedHeadRevision: 0 }), /云端已有更新/)
  await assert.rejects(identity(user.id, 'local', tx => tx`update aigc.suite_slots set active_version_id=${generatedVersions[0].id} where id=${config.slots[2].id}`), /foreign key/)
  await assert.rejects(identity(user.id, 'local', tx => tx`update aigc.suite_versions set snapshot='{}' where id=${generatedVersions[0].id}`), /permission denied/)
  checks.push('Mock 原任务结算两张成功费用；并发登记两候选不重复；多候选不自动覆盖；版本不可更新，跨槽位指针外键拒绝')

  const versionObject = detail.assets.find(asset => asset.assetId === generatedVersions[0].assetId)!.objectKey
  assert.ok(objects.has(versionObject))
  await sql`delete from aigc.image_jobs where id=${job.id}`
  const retained = await getSuite(user, project.id)
  assert.equal(retained.versions.filter(version => version.slotId === config.slots[1].id).length, 2)
  assert.ok(retained.operations.some(operation => operation.task?.sourceId === job.id))
  assert.equal(submissions, before)
  checks.push('原任务清理后长期资产、不可变版本与执行凭据仍保留，查询不重新生成')
  // 后续场景均使用合成图片和独立临时账本，不连接真实供应商或对象桶。
  const fixture = async (owner = user) => {
    const baseId = randomUUID()
    const next: SuiteProjectConfig = { ...config, title: '阶段三合成并发样例', baseAssetId: baseId,
      facts: [{ id: randomUUID(), kind: 'dimension', name: '长度', subject: 'product', axis: 'length', value: 20, unit: 'cm', originalText: '长度20cm', confirmed: true, source: 'user' }],
      slots: config.slots.map(slot => ({ ...slot, id: randomUUID(), referenceAssetIds: ['size', 'detail'].includes(slot.kind) ? [baseId] : [] })) }
    const created = await createSuite(owner, { requestId: randomUUID(), config: { ...next, slots: next.slots.map(slot => ({ ...slot, referenceAssetIds: [] })) } })
    const upload = await beginSuiteUpload(owner, created.id, { requestId: baseId, name: '合成资料', mimeType: 'image/png', bytes: MOCK_PNG_1X1.length }, storage)
    objects.set(upload.uploadUrl!, { bytes: Buffer.from(MOCK_PNG_1X1), contentType: 'image/png' })
    await completeSuiteUpload(owner, created.id, { assetId: baseId, uploadId: upload.uploadId }, storage)
    return updateSuite(owner, created.id, { expectedRevision: created.revision, config: next })
  }
  const selection = (entry: Awaited<ReturnType<typeof fixture>>, indices: number[]) => ({ expectedRevision: entry.revision,
    slots: indices.map(index => ['main', 'size', 'detail'].includes(entry.config.slots[index].kind)
      ? { slotId: entry.config.slots[index].id, mode: 'reuse' as const }
      : { slotId: entry.config.slots[index].id, mode: 'image_edit' as const, modelProfileId: 'mock:image-stage2', resolution: '1k' as const, count: 1, note: '' }) })
  const claimNext = async () => (await withImageMaintenance(tx => tx`select * from aigc.claim_due_suite_operation('local',${randomUUID()}::uuid)`))[0] as SuiteClaim | undefined
  const due = async () => { await sql`update aigc.suite_operations set next_attempt_at=now()-interval '1 second'`; await sql`update aigc.image_jobs set next_poll_at=now()-interval '1 second'` }
  const drain = async () => {
    await due()
    const original = await maintainImageJobs(runtime, randomUUID(), { delete: async key => { objects.delete(key) } })
    assert.equal(original.failed, 0, '原图片维护器应独立收口，无真实对象存储调用')
    await maintainSuiteBatches(runtime, randomUUID(), storage)
  }
  const seven = await fixture()
  const sevenQuote = await quoteSuite(user, seven.id, selection(seven, [0, 1, 2, 3, 4, 5, 6]), runtime)
  assert.equal(sevenQuote.items.length, 7)
  assert.equal(sevenQuote.totalCredits, 4)
  const sevenRequest = acceptQuote(sevenQuote)
  const replayed = await Promise.all([createSuiteBatch(user, seven.id, sevenRequest, runtime), createSuiteBatch(user, seven.id, sevenRequest, runtime)])
  assert.equal(replayed[0].id, replayed[1].id)
  const sevenBatch = replayed[0]
  assert.equal((await sql`select count(*)::int as n from aigc.image_jobs where origin->>'batchId'=${sevenBatch.id}`)[0].n, 0)
  await assert.rejects(createSuiteBatch(user, seven.id, acceptQuote(sevenQuote), runtime), /报价已被接受/)
  const anotherQuote = await quoteSuite(user, seven.id, selection(seven, [1]), runtime)
  await assert.rejects(createSuiteBatch(user, seven.id, acceptQuote(anotherQuote), runtime), /活动批次/)
  checks.push('七槽位持久计划与预算冻结；接受与并发重放均零预扣；同报价和同项目活动批次限制')

  const leases = (await Promise.all([claimNext(), claimNext()])).filter((value): value is SuiteClaim => Boolean(value))
  assert.equal(leases.length, 1, '同一账号只领取一个派发项')
  const stale = leases[0]
  await sql`update aigc.suite_operations set lease_until=now()-interval '1 second' where id=${stale.id}`
  const replacement = await claimNext()
  assert.ok(replacement)
  assert.equal(replacement.id, stale.id)
  assert.notEqual(replacement.lease_token, stale.lease_token)
  assert.equal((await dispatchSuiteClaim(stale, runtime)).fenced, true)
  await stopSuiteBatch(user, seven.id, sevenBatch.id)
  assert.equal((await dispatchSuiteClaim(replacement, runtime)).fenced, true)
  assert.equal((await sql`select count(*)::int as n from aigc.image_jobs where origin->>'batchId'=${sevenBatch.id}`)[0].n, 0)
  checks.push('实际双执行器领取互斥；租约过期重新领取；旧令牌与停止后的令牌均不能创建原任务')

  const retryQuote = await quoteSuite(user, seven.id, { ...selection(seven, [0, 1, 2, 3, 4, 5, 6]), retryOfBatchId: sevenBatch.id }, runtime)
  const retryBatch = await createSuiteBatch(user, seven.id, acceptQuote(retryQuote), runtime)
  const pickedSlot = seven.config.slots[1].id
  await sql`update aigc.suite_operations set next_attempt_at=now()+interval '1 hour' where batch_id=${retryBatch.id} and slot_id<>${pickedSlot}`
  const selectedClaim = await claimNext()
  assert.ok(selectedClaim)
  const doubleDispatch = await Promise.all([dispatchSuiteClaim(selectedClaim, runtime), dispatchSuiteClaim(selectedClaim, runtime)])
  const first = doubleDispatch.find(result => result.image)!.image!
  assert.equal(doubleDispatch.filter(result => result.image).length, 1)
  assert.equal((await sql`select count(*)::int as n from aigc.credit_ledger where job_id=${first.job.id} and kind='reserve'`)[0].n, 1)
  await stopSuiteBatch(user, seven.id, retryBatch.id)
  await advanceImageClaim(first, { ...runtime, execution: sqlImageExecution(user.id, '') }, true)
  await sql`update aigc.image_jobs set next_poll_at=now()-interval '1 second' where id=${first.job.id}`
  await loadImageTask(user, first.job.id, runtime)
  await sql`update aigc.suite_operations set lease_until=now()-interval '1 second',next_attempt_at=now()-interval '1 second' where id=${selectedClaim.id}`
  for (let index = 0; index < 2; index++) await drain()
  const retriedDetail = await getSuite(user, seven.id)
  assert.equal(retriedDetail.batches.find(batch => batch.id === retryBatch.id)?.state, 'partial')
  assert.equal(retriedDetail.operations.filter(op => op.batchId === retryBatch.id && op.retryOfOperationId).length, 7)
  assert.equal(retriedDetail.operations.filter(op => op.batchId === retryBatch.id && op.phase === 'stopped').length, 6)
  await assert.rejects(quoteSuite(user, seven.id, { ...selection(seven, [1]), retryOfBatchId: sevenBatch.id }, runtime), /已有后续尝试/)
  await assert.rejects(quoteSuite(user, seven.id, { ...selection(seven, [1]), retryOfBatchId: retryBatch.id }, runtime), /成功候选/)
  checks.push('重复派发同令牌只建一个原任务和预扣；停止保留已绑定原任务结算；重试关联原操作且拒绝成功项')

  // 不开启页面、不调用项目恢复接口，连续维护轮次独立登记七槽位。
  const autonomousQuote = await quoteSuite(user, seven.id, selection(seven, [0, 1, 2, 3, 4, 5, 6]), runtime)
  const autonomous = await createSuiteBatch(user, seven.id, acceptQuote(autonomousQuote), runtime)
  for (let index = 0; index < 10; index++) await drain()
  const automatic = await getSuite(user, seven.id)
  assert.equal(automatic.batches.find(batch => batch.id === autonomous.id)?.state, 'succeeded')
  assert.equal(automatic.project.slotHeads[1].activeVersionId, retriedDetail.project.slotHeads[1].activeVersionId, '重生成只存候选，保留已选版本')
  assert.equal(automatic.operations.filter(op => op.batchId === autonomous.id && op.appliedVersionIds.length).length, 7)
  checks.push('无浏览器参与的连续维护轮次完成七槽位首次派发、原任务结算与候选登记；已有成品不被重生成覆盖')

  const sidebar = await withTaskCenterRead(user, repository => repository.sidebar())
  assert.ok(sidebar.items.some(task => task.sourceKind === 'suite_batch'))
  assert.equal(sidebar.items.some(task => task.sourceKind === 'image_job' && task.origin?.entry === 'ecommerce'), false)
  const parent = await withTaskCenterRead(user, async repository => repository.get('suite_batch', autonomous.id))
  assert.equal(Number(parent.requested_count), 7)
  assert.equal(Number(parent.completed_count), 7)
  assert.equal(Number(parent.ledger_charge), 4)
  const children = await withTaskCenterRead(user, repository => repository.batchChildren(autonomous.id))
  assert.equal(children.length, 4)
  const deepLink = await readSuiteBatch(user, seven.id, autonomous.id)
  assert.equal(deepLink.operations.length, 7)
  assert.equal(deepLink.tasks.length, 4)
  await assert.rejects(readSuiteBatch(other, seven.id, autonomous.id), /不存在或无权/)
  assert.equal(children.every(task => task.sourceKind === 'image_job'), true)
  await identity(user.id, 'local', tx => taskRepository(queryPort(tx), user.id, 'local').presentation('suite_batch', autonomous.id, 'seen', String(parent.outcome_version)))
  await assert.rejects(withTaskCenterRead(other, repository => repository.get('suite_batch', autonomous.id)), /不存在或无权/)
  await assert.rejects(identity(user.id, 'local', tx => tx`select * from aigc.claim_due_suite_operation('local',${randomUUID()}::uuid)`), /套图维护范围无效/)
  await assert.rejects(withImageMaintenance(tx => tx`select * from aigc.claim_due_suite_operation('production',${randomUUID()}::uuid)`), /套图维护范围无效/)
  checks.push('父批次真实 SQL 投影按七槽位计数并汇总四个原任务账本；侧栏折叠、原详情、标记已读和越权拒绝')

  const budgetFixture = await fixture(other)
  const budgetQuote = await quoteSuite(other, budgetFixture.id, selection(budgetFixture, [1, 2]), runtime)
  const budgetBatch = await createSuiteBatch(other, budgetFixture.id, acceptQuote(budgetQuote), runtime)
  await sql`update aigc.credit_accounts set balance=0 where user_id=${other.id} and scope='local'`
  await due(); await maintainSuiteBatches(runtime, randomUUID(), storage)
  const noBalance = await getSuite(other, budgetFixture.id)
  assert.equal(noBalance.batches.find(batch => batch.id === budgetBatch.id)?.state, 'blocked')
  assert.equal(noBalance.operations.filter(op => op.batchId === budgetBatch.id && op.phase === 'blocked').length, 2)
  assert.equal((await sql`select count(*)::int as n from aigc.image_jobs where origin->>'batchId'=${budgetBatch.id}`)[0].n, 0)
  checks.push('余额不足回滚原任务与预扣，并阻塞全部尚未执行项，不自动换编号重试')

  const deadlineFixture = await fixture()
  const deadlineQuote = await quoteSuite(user, deadlineFixture.id, selection(deadlineFixture, [1]), runtime)
  const deadlineBatch = await createSuiteBatch(user, deadlineFixture.id, acceptQuote(deadlineQuote), runtime)
  const pastCreated = new Date(Date.now() - 1801000).toISOString()
  const pastDeadline = new Date(Date.parse(pastCreated) + 1800000).toISOString()
  await sql`update aigc.suite_batches set snapshot=jsonb_set(jsonb_set(snapshot,'{createdAt}',to_jsonb(${pastCreated}::text)),'{dispatchDeadlineAt}',to_jsonb(${pastDeadline}::text)) where id=${deadlineBatch.id}`
  await sql`update aigc.suite_operations set next_attempt_at=now()+interval '1 hour' where batch_id=${deadlineBatch.id}`
  const deadlineClaim = await claimNext(); assert.ok(deadlineClaim)
  assert.equal(deadlineClaim.batch_id, deadlineBatch.id, '截止优先于较长的限流等待')
  await dispatchSuiteClaim(deadlineClaim, runtime)
  assert.equal((await getSuite(user, deadlineFixture.id)).batches.find(batch => batch.id === deadlineBatch.id)?.state, 'stopped')
  checks.push('三十分钟截止优先于一小时限流等待，停止未执行项且零原任务、零预扣')
  await stopSuiteBatch(other, budgetFixture.id, budgetBatch.id)
  await sql`update aigc.credit_accounts set balance=100 where user_id=${other.id} and scope='local'`
  const rateFixture = await fixture(other)
  const rateQuote = await quoteSuite(other, rateFixture.id, selection(rateFixture, [1]), runtime)
  const rateBatch = await createSuiteBatch(other, rateFixture.id, acceptQuote(rateQuote), runtime)
  const throttled = { ...runtime, providerFor: () => ({ ...provider, mapRequest: () => { throw new HttpError(429, '合成容量限制', 'RATE_LIMIT', { extra: { retryAfterSeconds: 45 } }) } }) }
  await maintainSuiteBatches(throttled, randomUUID(), storage)
  const [rateOperation] = await sql`select snapshot,next_attempt_at from aigc.suite_operations where batch_id=${rateBatch.id}`
  assert.equal(rateOperation.snapshot.phase, 'waiting')
  assert.ok(new Date(rateOperation.next_attempt_at).getTime() > Date.now() + 35000)
  assert.equal((await sql`select count(*)::int as n from aigc.image_jobs where origin->>'batchId'=${rateBatch.id}`)[0].n, 0)
  await due()
  const changed = { ...runtime, providerFor: () => ({ ...provider, mapRequest: (...args: Parameters<typeof provider.mapRequest>) => {
    const mapped = provider.mapRequest(...args); return { ...mapped, providerParams: { ...mapped.providerParams, model: 'changed-after-accept' } }
  } }) }
  await maintainSuiteBatches(changed, randomUUID(), storage)
  assert.equal((await getSuite(other, rateFixture.id)).batches.find(batch => batch.id === rateBatch.id)?.state, 'blocked')
  await stopSuiteBatch(other, rateFixture.id, rateBatch.id)
  checks.push('确认未创建的限流按原 retryAfter 延迟首次派发；目录映射变化阻塞而非接受新价格或渠道')

  const competing = await fixture(other)
  const competingQuote = await quoteSuite(other, competing.id, selection(competing, [1]), runtime)
  const competingBatch = await createSuiteBatch(other, competing.id, acceptQuote(competingQuote), runtime)
  await sql`update aigc.credit_accounts set balance=1 where user_id=${other.id} and scope='local'`
  const competingClaim = await claimNext(); assert.ok(competingClaim)
  const rawRequestId = randomUUID()
  const competingAsset = (await getSuite(other, competing.id)).assets.find(asset => asset.assetId === competing.config.baseAssetId)!
  const contested = await Promise.allSettled([
    dispatchSuiteClaim(competingClaim, runtime),
    submitImageTask(other, { requestId: rawRequestId, capability: 'image_edit', modelProfileId: 'mock:image-stage2',
      params: { sourceImageKey: competingAsset.objectKey, sourceWidth: 1, sourceHeight: 1, prompt: '普通工作站合成争用', resolution: '1k', count: 1 } }, runtime),
  ])
  assert.equal(contested.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await sql`select balance from aigc.credit_accounts where user_id=${other.id} and scope='local'`)[0].balance, 0)
  const [count] = await sql`select count(*)::int as n from aigc.image_jobs where request_id=${rawRequestId} or origin->>'batchId'=${competingBatch.id}`
  assert.equal(count.n, 1)
  await sql`update aigc.suite_operations set lease_until=now()-interval '1 second' where id=${competingClaim.id}`
  const suiteWinner = contested[0]
  if (suiteWinner.status === 'fulfilled' && suiteWinner.value.image)
    await advanceImageClaim(suiteWinner.value.image, { ...runtime, execution: sqlImageExecution(other.id, '') }, true)
  for (let index = 0; index < 3; index++) await drain()
  await stopSuiteBatch(other, competing.id, competingBatch.id)
  checks.push('套图与普通图片入口争用最后一积分，仅一方创建并预扣，余额不为负')

  const noSubmitFixture = await fixture()
  const noSubmitQuote = await quoteSuite(user, noSubmitFixture.id, selection(noSubmitFixture, [1]), runtime)
  const noSubmitBatch = await createSuiteBatch(user, noSubmitFixture.id, acceptQuote(noSubmitQuote), runtime)
  const unchanged = submissions
  process.env.IMAGE_BACKGROUND_SUBMIT_ENABLED = 'false'
  await maintainSuiteBatches(runtime, randomUUID(), storage)
  process.env.IMAGE_BACKGROUND_SUBMIT_ENABLED = 'true'
  assert.equal(submissions, unchanged)
  assert.equal((await getSuite(user, noSubmitFixture.id)).operations[0].phase, 'waiting')
  assert.equal((await sql`select count(*)::int as n from aigc.image_jobs where origin->>'batchId'=${noSubmitBatch.id}`)[0].n, 0)
  await stopSuiteBatch(user, noSubmitFixture.id, noSubmitBatch.id)
  checks.push('全局后台首发关闭时零供应商提交且零新原任务，不以套图绕过保护')
  const mixed = await fixture()
  const mixedRequest = selection(mixed, [0, 1, 2, 3, 4, 5, 6])
  const sceneSelection = mixedRequest.slots[1]
  if (sceneSelection.mode === 'image_edit') sceneSelection.count = 4
  const mixedQuote = await quoteSuite(user, mixed.id, mixedRequest, runtime)
  const mixedBatch = await createSuiteBatch(user, mixed.id, acceptQuote(mixedQuote), runtime)
  for (let iteration = 0; iteration < 12; iteration++) {
    await due()
    const jobs = await sql`select id,origin from aigc.image_jobs where origin->>'batchId'=${mixedBatch.id} and status in ('queued','processing')`
    for (const job of jobs) {
      const items = await sql`select ordinal,provider_task_id from aigc.image_job_items where job_id=${job.id}`
      for (const item of items) if (item.provider_task_id && (
        [mixed.config.slots[2].id, mixed.config.slots[3].id].includes(job.origin.slotId)
          || job.origin.slotId === mixed.config.slots[1].id && item.ordinal >= 2)) rejectedTasks.add(String(item.provider_task_id))
      await loadImageTask(user, String(job.id), runtime)
    }
    await maintainSuiteBatches(runtime, randomUUID(), storage)
  }
  const mixedDetail = await getSuite(user, mixed.id)
  assert.equal(mixedDetail.project.slotHeads.every(head => head.activeVersionId === null), true, '后台只存候选，不假设本机没有未同步草稿')
  assert.equal(mixedDetail.batches.find(batch => batch.id === mixedBatch.id)?.state, 'partial')
  assert.equal(mixedDetail.operations.filter(op => op.batchId === mixedBatch.id && op.appliedVersionIds.length).length, 5)
  const mixedTask = mixedDetail.tasks.find(task => task.origin?.entry === 'ecommerce' && task.origin.batchId === mixedBatch.id && task.origin.slotId === mixed.config.slots[1].id)!
  assert.equal(mixedTask.completedCount, 2)
  assert.equal(mixedTask.requestedCount, 4)
  assert.equal(mixedTask.creditsCharged, 2)
  const mixedParent = await withTaskCenterRead(user, repository => repository.get('suite_batch', mixedBatch.id))
  assert.equal(Number(mixedParent.completed_count), 5)
  assert.equal(Number(mixedParent.requested_count), 7)
  assert.equal(Number(mixedParent.ledger_charge), 3)
  checks.push('七槽位两个失败、同槽四候选两个成功：父级5/7、子级2/4，原账本只结算三个成功候选')

  const transfer = await fixture()
  const transferQuote = await quoteSuite(user, transfer.id, selection(transfer, [1]), runtime)
  const transferBatch = await createSuiteBatch(user, transfer.id, acceptQuote(transferQuote), runtime)
  await maintainSuiteBatches(runtime, randomUUID(), storage)
  const [transferJob] = await sql`select id from aigc.image_jobs where origin->>'batchId'=${transferBatch.id}`
  await due(); await loadImageTask(user, String(transferJob.id), runtime)
  const transferClaim = await claimNext(); assert.ok(transferClaim)
  const beforeTransfer = submissions
  await assert.rejects(registerSuiteOperationResults(user, transfer.id, transferBatch.id, transferClaim.id,
    { ...storage, put: async () => { throw new Error('合成转存失败') } }, transferClaim.lease_token), /合成转存失败/)
  const late = await registerSuiteOperationResults(user, transfer.id, transferBatch.id, transferClaim.id,
    { ...storage, put: async (key, bytes, type) => {
      await storage.put(key, bytes, type)
      await sql`update aigc.suite_operations set lease_token=${randomUUID()} where id=${transferClaim.id}`
    } }, transferClaim.lease_token)
  assert.equal(late, null)
  assert.equal((await getSuite(user, transfer.id)).versions.length, 0)
  await sql`update aigc.suite_operations set lease_until=now()-interval '1 second' where id=${transferClaim.id}`
  await due(); await maintainSuiteBatches(runtime, randomUUID(), storage)
  assert.equal((await getSuite(user, transfer.id)).versions.length, 1)
  assert.equal(submissions, beforeTransfer)
  checks.push('对象转存失败仅重做登记；转存后旧租约晚到不应用，新租约修复只创建一个版本且零再次提交')
  const editable = await fixture()
  const editableQuote = await quoteSuite(user, editable.id, selection(editable,[0]), runtime)
  await createSuiteBatch(user,editable.id,acceptQuote(editableQuote),runtime)
  await drain(); await drain()
  let editableDetail = await getSuite(user,editable.id)
  const baseVersion = editableDetail.versions[0], editableSlot = baseVersion.slotId
  await selectSuiteVersion(user,editable.id,editableSlot,{versionId:baseVersion.id,expectedHeadRevision:0})
  const textLayer = {id:randomUUID(),type:'text' as const,text:'已确认商品展示',position:{x:.1,y:.1},width:.6,fontFamily:'Noto Sans SC' as const,fontSize:.035,fontWeight:500 as const,color:'#111827',background:'#ffffff',align:'left' as const,zIndex:0}
  const dimensionLayer = {id:randomUUID(),type:'dimension' as const,factId:editable.config.facts[0].id,start:{x:.1,y:.8},end:{x:.9,y:.8},labelPosition:{x:.5,y:.8},color:'#111827',strokeWidth:.002,fontSize:.035,zIndex:1}
  const draft = {expectedDraftRevision:0,baseVersionId:baseVersion.id,promptNote:'生成要求与图层共存',count:1,resolution:'1k',modelProfileId:null,layers:[textLayer,dimensionLayer],factsSnapshot:baseVersion.composition.factsSnapshot}
  const draftSaves = await Promise.allSettled([saveSuiteDraft(user,editable.id,editableSlot,draft),saveSuiteDraft(user,editable.id,editableSlot,{...draft,promptNote:'另一个编辑者'})])
  assert.equal(draftSaves.filter(result=>result.status==='fulfilled').length,1)
  const annotationRequest = {requestId:randomUUID(),baseVersionId:baseVersion.id,expectedHeadRevision:1,expectedDraftRevision:1,
    composition:{...baseVersion.composition,layersSnapshot:[textLayer,dimensionLayer],rendererVersion:'suite-canvas-v1'}}
  const annotated = await Promise.all([saveSuiteVersion(user,editable.id,editableSlot,annotationRequest),saveSuiteVersion(user,editable.id,editableSlot,annotationRequest)])
  assert.equal(annotated[0].version.id,annotated[1].version.id)
  assert.equal(annotated[0].version.versionNumber,2)
  assert.equal(annotated[0].version.source,'annotation_edit')
  assert.equal(annotated[0].version.sourceTask,undefined)
  await assert.rejects(saveSuiteVersion(user,editable.id,editableSlot,{...annotationRequest,composition:{...annotationRequest.composition,layersSnapshot:[{...textLayer,text:'请求内容改变'}]}}),/保存编号/)
  await assert.rejects(saveSuiteVersion(user,editable.id,editableSlot,{...annotationRequest,requestId:randomUUID()}),/云端已有更新/)
  const currentAnnotation = annotated[0].version
  await assert.rejects(saveSuiteVersion(user,editable.id,editableSlot,{...annotationRequest,requestId:randomUUID(),baseVersionId:currentAnnotation.id,expectedHeadRevision:2,
    composition:{...currentAnnotation.composition,factsSnapshot:[{...editable.config.facts[0],value:999}]}}),/规格尚未确认或已变化/)
  const noChange = await saveSuiteVersion(user,editable.id,editableSlot,{...annotationRequest,requestId:randomUUID(),baseVersionId:currentAnnotation.id,expectedHeadRevision:2,composition:currentAnnotation.composition})
  assert.equal(noChange.version.id,currentAnnotation.id)
  checks.push('图层草稿并发乐观锁只允许一方；保存重放只有一个不可变版本；同键异参、过时指针与伪造规格拒绝；无变化不建空版本')

  const originalSubmissions = submissions
  const bridgeSessions=[]
  for(const tool of ['smart-edit','retouch','relight','repaint'] as const) {
    const bridge=await createSuiteBridge(user,editable.id,{slotId:editableSlot,sourceVersionId:currentAnnotation.id,expectedHeadRevision:2,tool,inputMode:'base'})
    bridgeSessions.push(bridge)
    const recovered=await readSuiteBridge(user,bridge.id)
    assert.equal(recovered.asset.assetId,currentAnnotation.assetId)
    await assert.rejects(readSuiteBridge(other,bridge.id),/不存在或无权/)
  }
  assert.equal(submissions,originalSubmissions)
  const smartBridge=bridgeSessions[0], bridgeAsset=(await readSuiteBridge(user,smartBridge.id)).asset
  const params={sourceImageKey:bridgeAsset.objectKey,sourceWidth:1,sourceHeight:1,prompt:'套图来源的工作站合成验证',resolution:'1k',count:1}
  await assert.rejects(submitImageTask(user,{requestId:randomUUID(),capability:'image_edit',modelProfileId:'mock:image-stage2',params:{...params,sourceImageKey:competingAsset.objectKey},origin:{entry:'workstation',tool:'smart-edit',suiteBridgeId:smartBridge.id}},runtime),/来源不一致/)
  await assert.rejects(returnSuiteBridge(user,smartBridge.id,{requestId:randomUUID(),result:{sourceKind:'image_job',sourceId:String(transferJob.id),ordinal:0}},storage),/本会话原工具/)
  const workstation = await submitImageTask(user,{requestId:randomUUID(),capability:'image_edit',modelProfileId:'mock:image-stage2',params,origin:{entry:'workstation',tool:'smart-edit',suiteBridgeId:smartBridge.id}},runtime)
  await due(); await loadImageTask(user,workstation.id,runtime)
  assert.ok((await readSuiteBridge(user,smartBridge.id)).availableResults.some(result=>result.sourceId===workstation.id))
  const headBeforeReturn=(await getSuite(user,editable.id)).project.slotHeads.find(head=>head.slotId===editableSlot)!
  const returnRequest={requestId:randomUUID(),result:{sourceKind:'image_job',sourceId:workstation.id,ordinal:0}}
  const beforeReturns=submissions
  const returned=await Promise.all([returnSuiteBridge(user,smartBridge.id,returnRequest,storage),returnSuiteBridge(user,smartBridge.id,returnRequest,storage)])
  assert.equal(returned[0].version.id,returned[1].version.id)
  assert.deepEqual(returned[0].version.composition.layersSnapshot,currentAnnotation.composition.layersSnapshot)
  assert.equal(returned[0].version.sourceTool,'smart-edit')
  assert.deepEqual((await getSuite(user,editable.id)).project.slotHeads.find(head=>head.slotId===editableSlot),headBeforeReturn)
  assert.equal(submissions,beforeReturns)
  await selectSuiteVersion(user,editable.id,editableSlot,{versionId:baseVersion.id,expectedHeadRevision:2})
  const staleReturn=await returnSuiteBridge(user,smartBridge.id,{...returnRequest,requestId:randomUUID()},storage)
  assert.equal(staleReturn.version.id,returned[0].version.id)
  assert.equal((await getSuite(user,editable.id)).project.slotHeads.find(head=>head.slotId===editableSlot)?.activeVersionId,baseVersion.id)
  process.env.AIGC_RUNTIME_SCOPE='preview'
  await assert.rejects(readSuiteBridge(user,smartBridge.id),/不存在或无权/)
  process.env.AIGC_RUNTIME_SCOPE='local'
  checks.push('四工具会话恢复隔离；伪造输入与无关联原结果拒绝；真实原图片任务回填并发幂等且零再次提交、零指针覆盖，过时来源保留候选')

  for (const bridge of bridgeSessions.slice(1,3)) {
    const extra = bridge.tool === 'retouch' ? {retouchDirections:['texture']} : {relight:{direction:'front',quality:'soft',temperature:'neutral'}}
    const task = await submitImageTask(user,{requestId:randomUUID(),capability:'image_edit',modelProfileId:'mock:image-stage2',params:{...params,...extra},origin:{entry:'workstation',tool:bridge.tool,suiteBridgeId:bridge.id}},runtime)
    await due();await loadImageTask(user,task.id,runtime)
    const beforeLedger=(await sql`select count(*)::int as n from aigc.credit_ledger where job_id=${task.id}`)[0].n
    const result=await returnSuiteBridge(user,bridge.id,{requestId:randomUUID(),result:{sourceKind:'image_job',sourceId:task.id,ordinal:0}},storage)
    assert.equal(result.version.sourceTool,bridge.tool)
    assert.equal((await sql`select count(*)::int as n from aigc.credit_ledger where job_id=${task.id}`)[0].n,beforeLedger)
  }
  checks.push('精修与重新打光实际走原图片服务，按真实工具参数绑定会话，回填不新增原账本流水')
  const repaintBridge=bridgeSessions[3], repaintRequest=randomUUID()
  const repaintInput={sourceImageKey:bridgeAsset.objectKey,prompt:'合成重绘',origin:{entry:'workstation',tool:'repaint',suiteBridgeId:repaintBridge.id}}
  await withSyncCredits(user,'repaint',{requestId:repaintRequest,priceVersion:SYNC_PRICE_VERSION,maxCredits:5},repaintInput,async()=>({kind:'object',objectKey:bridgeAsset.objectKey,mimeType:'image/png',bytes:MOCK_PNG_1X1.length,signed:{url:'https://fixture.invalid/result',expiresAt:Date.now()+10000}}))
  const repaintReturn=await returnSuiteBridge(user,repaintBridge.id,{requestId:randomUUID(),result:{sourceKind:'sync_credit',sourceId:repaintRequest,ordinal:0}},storage)
  assert.equal(repaintReturn.version.sourceTool,'repaint')
  assert.equal(repaintReturn.version.sourceRequestId,repaintRequest)
  assert.equal((await sql`select charged from aigc.credit_ledger where job_id=${repaintRequest} and kind='settle'`)[0].charged,5)
  const compositeBridge=await createSuiteBridge(user,editable.id,{slotId:editableSlot,sourceVersionId:baseVersion.id,expectedHeadRevision:3,tool:'smart-edit',inputMode:'composite',compositeAssetId:bridgeAsset.assetId})
  const compositeJob=await submitImageTask(user,{requestId:randomUUID(),capability:'image_edit',modelProfileId:'mock:image-stage2',params,origin:{entry:'workstation',tool:'smart-edit',suiteBridgeId:compositeBridge.id}},runtime)
  await due();await loadImageTask(user,compositeJob.id,runtime)
  const compositeReturn=await returnSuiteBridge(user,compositeBridge.id,{requestId:randomUUID(),result:{sourceKind:'image_job',sourceId:compositeJob.id,ordinal:0}},storage)
  assert.deepEqual(compositeReturn.version.composition.layersSnapshot,[])
  await sql`update aigc.suite_bridges set expires_at=now()-interval '1 second' where id=${smartBridge.id}`
  await assert.rejects(readSuiteBridge(user,smartBridge.id),/已过期/)
  await assert.rejects(returnSuiteBridge(user,smartBridge.id,returnRequest,storage),/已过期/)
  checks.push('同步重绘沿用原五积分账本且回填不重复扣费；合成图回填清空已烘焙图层；七天过期拒绝会话与回填')

  editableDetail=await getSuite(user,editable.id)
  const amazonConfig={...editableDetail.project.config,platform:'amazon',marketplace:'US',ruleProfile:{id:'amazon-us-home-kitchen',version:'draft-v1'}}
  await updateSuite(user,editable.id,{expectedRevision:editableDetail.project.revision,config:amazonConfig})
  await assert.rejects(selectSuiteVersion(user,editable.id,editableSlot,{versionId:currentAnnotation.id,expectedHeadRevision:3}),/Amazon 主图/)
  await assert.rejects(saveSuiteVersion(user,editable.id,editableSlot,{requestId:randomUUID(),baseVersionId:baseVersion.id,expectedHeadRevision:3,composition:annotationRequest.composition}),/Amazon 主图/)
  const beforeHistorical=JSON.stringify(currentAnnotation.composition)
  await updateSuite(user,editable.id,{expectedRevision:editableDetail.project.revision+1,config:{...editableDetail.project.config,facts:editableDetail.project.config.facts.map(fact=>({...fact,value:40}))}})
  assert.equal(JSON.stringify((await getSuite(user,editable.id)).versions.find(version=>version.id===currentAnnotation.id)!.composition),beforeHistorical)
  checks.push('平台切换按主图语义锁定接口，历史图层不变；项目规格修改不会改写历史尺寸快照')

  const sourceDetail=await getSuite(user,editable.id), recoveredId=randomUUID(), recoveredAsset=randomUUID()
  const restoredSlots=sourceDetail.project.config.slots.map(slot=>({...slot,id:randomUUID(),referenceAssetIds:[]}))
  const restoredConfig={...sourceDetail.project.config,baseAssetId:recoveredAsset,slots:restoredSlots}
  const restoredProject=await createSuite(user,{requestId:randomUUID(),config:restoredConfig})
  const restoreUpload=await beginSuiteUpload(user,restoredProject.id,{requestId:recoveredAsset,name:'恢复图片',mimeType:'image/png',bytes:MOCK_PNG_1X1.length},storage)
  objects.set(restoreUpload.uploadUrl!,{bytes:Buffer.from(MOCK_PNG_1X1),contentType:'image/png'})
  await completeSuiteUpload(user,restoredProject.id,{assetId:recoveredAsset,uploadId:restoreUpload.uploadId},storage)
  const restoreRequest={requestId:randomUUID(),config:restoredConfig,versions:[{id:recoveredId,slotId:restoredSlots[0].id,parentVersionId:null,assetId:recoveredAsset,versionNumber:1,composition:currentAnnotation.composition}],
    heads:restoredSlots.map((slot,index)=>({slotId:slot.id,activeVersionId:index===0?recoveredId:null})),drafts:[]}
  const beforeRestore=submissions
  await restoreSuiteSnapshot(user,restoredProject.id,restoreRequest)
  await restoreSuiteSnapshot(user,restoredProject.id,restoreRequest)
  const restored=await getSuite(user,restoredProject.id)
  assert.equal(restored.versions.length,1)
  assert.equal(restored.versions[0].sourceTask,undefined)
  assert.equal(restored.batches.length,0)
  assert.equal(restored.operations.length,0)
  assert.equal(submissions,beforeRestore)
  await assert.rejects(restoreSuiteSnapshot(user,restoredProject.id,{...restoreRequest,config:{...restoredConfig,title:'不同内容'}}),/恢复编号/)
  await assert.rejects(restoreSuiteSnapshot(other,restoredProject.id,restoreRequest),/不存在或无权/)
  for(const table of ['suite_bridges','suite_bridge_returns','suite_restore_receipts'])
    assert.equal((await identity(other.id,'local',tx=>tx.unsafe(`select 1 from aigc.${table} where user_id=$1`,[user.id]))).length,0)
  checks.push('恢复快照重放幂等，图片与图层历史完整、原任务身份与可执行队列为空；跨账号新表 RLS 和恢复权限隔离')
  const exportOutput = { platform: 'general', width: 1200, height: 1000, format: 'png', background: 'transparent' }
  const exportRequest = { versionIds: [currentAnnotation.id], output: exportOutput }
  const ledgerBeforePrecheck = (await sql`select count(*)::int as n from aigc.credit_ledger`)[0].n
  const submissionsBeforePrecheck = submissions
  const checked = await precheckSuite(user, editable.id, exportRequest)
  assert.equal(checked.items[0].version.id, currentAnnotation.id)
  assert.equal(checked.items[0].version.composition.factsSnapshot[0].value, 20)
  assert.equal((await precheckSuite(user, editable.id, exportRequest)).fingerprint, checked.fingerprint)
  assert.notEqual((await precheckSuite(user, editable.id, { ...exportRequest, output: { ...exportOutput, width: 2000 } })).fingerprint, checked.fingerprint)
  await assert.rejects(precheckSuite(other, editable.id, exportRequest), /不存在或无权/)
  await assert.rejects(precheckSuite(user, editable.id, { ...exportRequest, versionIds: [currentAnnotation.id, baseVersion.id] }), /同一槽位/)
  assert.equal((await sql`select count(*)::int as n from aigc.credit_ledger`)[0].n, ledgerBeforePrecheck)
  assert.equal(submissions, submissionsBeforePrecheck)
  checks.push('服务端预检冻结版本与历史事实，配置变化使指纹失效；跨账号和同槽多版本拒绝，零任务、零账本写入')

  const trash = await fixture()
  const trashQuote = await quoteSuite(user, trash.id, selection(trash, [0, 1]), runtime)
  const trashBatch = await createSuiteBatch(user, trash.id, acceptQuote(trashQuote), runtime)
  await recycleSuite(user, trash.id, false)
  assert.ok((await sql`select snapshot from aigc.suite_operations where batch_id=${trashBatch.id}`).every(row => row.snapshot.phase === 'stopped'))
  await recycleSuite(user, trash.id, true)
  assert.equal((await getSuite(user, trash.id)).project.deletedAt, null)
  assert.ok((await sql`select snapshot from aigc.suite_operations where batch_id=${trashBatch.id}`).every(row => row.snapshot.phase === 'stopped'), '恢复不自动恢复执行队列')
  await recycleSuite(user, trash.id, false)
  await sql`update aigc.suite_projects set deleted_at=now()-interval '8 days' where id=${trash.id}`
  await assert.rejects(recycleSuite(user, trash.id, true), /七天恢复/)
  const disabledCleanup = await cleanupSuiteAssets({ delete: async () => { throw new Error('关闭开关不应调用') } })
  assert.equal(disabledCleanup.disabled, true)
  checks.push('回收站停止未派发项，七天内可恢复且不恢复执行队列，超期拒绝；清理默认关闭且零对象删除')

  const cleanupProject = await fixture()
  const cleanupAsset = (await getSuite(user, cleanupProject.id)).assets[0]
  const originalInput = { sourceImageKey: cleanupAsset.objectKey, sourceWidth: 1, sourceHeight: 1, prompt: '清理引用保护', resolution: '1k', count: 1 }
  const retainedImage = await submitImageTask(user, { requestId: randomUUID(), capability: 'image_edit', modelProfileId: 'mock:image-stage2', params: originalInput, origin: { entry: 'workstation', tool: 'smart-edit' } }, runtime)
  await due(); await loadImageTask(user, retainedImage.id, runtime)
  const retainedSync = randomUUID()
  await withSyncCredits(user, 'repaint', { requestId: retainedSync, priceVersion: SYNC_PRICE_VERSION, maxCredits: 5 }, { sourceImageKey: cleanupAsset.objectKey, prompt: '同步输入保护' },
    async () => ({ kind: 'object', objectKey: `generated/${user.id}/${randomUUID()}.png`, bytes: MOCK_PNG_1X1.length, mimeType: 'image/png', signed: { url: 'https://fixture.invalid', expiresAt: Date.now() + 10000 } }))
  const orphanKey = suiteObjectKey(user, cleanupProject.id, randomUUID(), cleanupAsset.checksum, 'image/png')
  await beginSuiteObjectWrite(user, cleanupProject.id, orphanKey)
  await storage.put(orphanKey, MOCK_PNG_1X1, 'image/png')
  await recycleSuite(user, cleanupProject.id, false)
  await sql`update aigc.suite_projects set deleted_at=now()-interval '8 days' where id in (${trash.id},${cleanupProject.id})`
  await sql`update aigc.suite_object_writes set last_write_at=now()-interval '2 days' where project_id in (${trash.id},${cleanupProject.id})`
  process.env.ECOMMERCE_SUITE_CLEANUP_ENABLED = 'true'
  const ledgerBeforeCleanup = (await sql`select count(*)::int as n from aigc.credit_ledger`)[0].n
  const submissionsBeforeCleanup = submissions
  let failDelete = true
  const deleting = { delete: async (key: string) => { if (key === orphanKey && failDelete) throw new Error('对象桶暂不可用'); objects.delete(key) } }
  const firstCleanup = await cleanupSuiteAssets(deleting)
  assert.equal(firstCleanup.failures, 1)
  assert.ok(objects.has(orphanKey)); assert.ok(objects.has(cleanupAsset.objectKey))
  await sql`update aigc.suite_object_writes set next_attempt_at=now()-interval '1 second' where project_id=${cleanupProject.id}`
  failDelete = false
  await cleanupSuiteAssets(deleting)
  assert.equal(objects.has(orphanKey), false, '登记失败的持久对象也可在到期项目中清理')
  assert.ok(objects.has(cleanupAsset.objectKey), '原图片与同步记录仍引用时必须保留')
  await assert.rejects(getSuite(user, cleanupProject.id), /不存在或无权/)
  await assert.rejects(beginSuiteObjectWrite(user, cleanupProject.id, orphanKey), /不存在或无权/)
  await assert.rejects(submitImageTask(user, { requestId: randomUUID(), capability: 'image_edit', modelProfileId: 'mock:image-stage2', params: originalInput }, runtime), /套图图片未登记/)
  await assert.rejects(withSyncCredits(user, 'repaint', { requestId: randomUUID(), priceVersion: SYNC_PRICE_VERSION, maxCredits: 5 }, { sourceImageKey: cleanupAsset.objectKey }, async () => { throw new Error('不应调用供应商') }), /套图输入不存在/)
  checks.push('清理先隔离到期项目；原图片和无桥接同步输入保护仍有效，孤儿删除失败可重试，隔离后禁止新读写或原任务预扣')

  await sql`delete from aigc.image_jobs where id=${retainedImage.id}`
  await sql`update aigc.suite_object_writes set next_attempt_at=now()-interval '1 second' where project_id=${cleanupProject.id}`
  await cleanupSuiteAssets(deleting)
  assert.ok(objects.has(cleanupAsset.objectKey), '同步任务仍在原留存期内')
  await sql`delete from aigc.sync_credit_jobs where id=${retainedSync}`
  await sql`update aigc.suite_object_writes set next_attempt_at=now()-interval '1 second' where project_id=${cleanupProject.id}`
  const claims = (await Promise.all([withImageMaintenance(tx => tx`select * from aigc.claim_suite_object_cleanup('local')`), withImageMaintenance(tx => tx`select * from aigc.claim_suite_object_cleanup('local')`)])).flat()
  assert.equal(claims.length, 1, '并发执行器不得重复领取同对象')
  const oldCleanupToken = claims[0].lease_token
  await sql`update aigc.suite_object_writes set lease_until=now()-interval '1 second' where object_key=${cleanupAsset.objectKey}`
  const [reclaimed] = await withImageMaintenance(tx => tx`select * from aigc.claim_suite_object_cleanup('local')`)
  assert.ok(reclaimed); assert.notEqual(reclaimed.lease_token, oldCleanupToken)
  assert.equal((await withImageMaintenance(tx => tx`select aigc.finish_suite_object_cleanup(${cleanupAsset.objectKey},${oldCleanupToken}::uuid,true) as done`))[0].done, false)
  await sql`update aigc.suite_object_writes set lease_until=now()-interval '1 second' where object_key=${cleanupAsset.objectKey}`
  await cleanupSuiteAssets(deleting)
  assert.equal(objects.has(cleanupAsset.objectKey), false)
  assert.ok((await sql`select purged_at from aigc.suite_projects where id=${cleanupProject.id}`)[0].purged_at)
  assert.equal((await sql`select count(*)::int as n from aigc.credit_ledger`)[0].n, ledgerBeforeCleanup)
  assert.equal(submissions, submissionsBeforeCleanup)
  checks.push('原任务按自身留存结束后才清理输入；并发领取互斥、旧令牌拒绝，完成标记幂等且原账本与供应商调用数不变')

  await assert.rejects(identity(user.id, 'local', tx => tx`select aigc.start_expired_suite_cleanup('local')`), /范围无效/)
  await assert.rejects(withImageMaintenance(tx => tx`select aigc.claim_suite_object_cleanup('production')`), /范围无效/)
  await assert.rejects(identity(user.id, 'local', tx => tx`update aigc.suite_projects set purge_started_at=null where id=${cleanupProject.id}`), /permission denied/)
  for (const table of ['suite_object_writes', 'suite_sync_inputs']) {
    assert.equal((await identity(other.id, 'local', tx => tx.unsafe(`select 1 from aigc.${table} where user_id=$1`, [user.id]))).length, 0)
    assert.equal((await sql`select has_table_privilege('anon',${`aigc.${table}`},'select') as allowed`)[0].allowed, false)
  }
  checks.push('清理仅接受同环境内部维护身份，用户身份、跨环境、越权修改清理标记及读取引用表均拒绝')
  console.log(JSON.stringify({ kind: 'isolated_postgres_phase_five_mock_provider', postgresVersion: (await sql`select version() as version`)[0].version, checks,
    provider: 'mock', realProductSamples: 0, realProviderBillingVerified: false }, null, 2))
} finally { if (runtimeConnected) await database().end(); await sql.end() }
