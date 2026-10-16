import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { bootstrapImageTestDatabase } from '../server/image-jobs/database-fixture.js'
import { database } from '../server/db.js'
import { createSuite, findSuiteByRequest, getSuite, listSuites, selectSuiteVersion, updateSuite } from '../server/ecommerce-suite/projects.js'
import { beginSuiteUpload, completeSuiteUpload, type SuiteStorage } from '../server/ecommerce-suite/assets.js'
import { createSuiteBatch, findSuiteBatch, quoteSuite } from '../server/ecommerce-suite/generation.js'
import { registerSuiteResults } from '../server/ecommerce-suite/results.js'
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
  Object.assign(process.env, { AIGC_DATABASE_URL: url, AIGC_DB_LOCAL: 'true', AIGC_RUNTIME_SCOPE: 'local', VERCEL_ENV: 'development', AIGC_IMAGE_MOCK_PROVIDER: 'true' })
  runtimeConnected = true
  const user = { id: users[0], email: 'suite-test@example.invalid', suggestedName: '套图验收', avatarUrl: null, providers: ['email'] }
  const other = { ...user, id: users[1] }
  const objects = new Map<string, { bytes: Buffer; contentType: string }>()
  let submissions = 0
  const provider = createMockImageProvider({ submit: async (_input, context) => { submissions++; return { providerTaskId: `mock-${context.now()}-${submissions}` } } })
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
  console.log(JSON.stringify({ kind: 'isolated_postgres_mock_provider', postgresVersion: (await sql`select version() as version`)[0].version, checks,
    provider: 'mock', realProductSamples: 0, realProviderBillingVerified: false }, null, 2))
} finally { if (runtimeConnected) await database().end(); await sql.end() }
