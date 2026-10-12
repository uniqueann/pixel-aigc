import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { bootstrapImageTestDatabase } from '../server/image-jobs/database-fixture.js'
import { createSqlStore } from '../server/image-jobs/repository.js'
import { createSqlBilling } from '../server/image-jobs/billing.js'
import { advanceImageClaim,defaultImageJobRuntime,loadImageTask,submitImageTask,type ImageJobRuntime } from '../server/image-jobs/service.js'
import { sqlImageExecution } from '../server/image-jobs/execution.js'
import { maintainImageJobs } from '../server/image-jobs/maintenance.js'
import { createMockImageProvider,MOCK_PNG_1X1 } from '../server/image-providers/mock.js'
import { database,type Transaction } from '../server/db.js'

// 缺少真实连接必须失败；绝不改用 PGlite 或业务数据库。
const url = process.env.IMAGE_TEST_DATABASE_URL
if (!url || process.env.IMAGE_TEST_DATABASE_CONFIRM !== 'isolated') throw new Error('请配置空白独立库 IMAGE_TEST_DATABASE_URL，并设置 IMAGE_TEST_DATABASE_CONFIRM=isolated')
const parsed = new URL(url)
if (!['127.0.0.1','localhost','[::1]'].includes(parsed.hostname) && process.env.IMAGE_TEST_ALLOW_REMOTE !== 'true') throw new Error('远端独立库须显式设置 IMAGE_TEST_ALLOW_REMOTE=true')
for (const key of ['AIGC_DATABASE_URL','AIGC_ADMIN_DATABASE_URL']) {
  const configured = process.env[key]
  if (configured && new URL(configured).host === parsed.host && new URL(configured).pathname === parsed.pathname) throw new Error('测试连接不能复用业务数据库')
}
const local = ['127.0.0.1','localhost','[::1]'].includes(parsed.hostname)
const options = { max: 1,prepare: false,ssl: local ? false as const : 'require' as const }
const admin = postgres(url,options)
const first = postgres(url,options)
const second = postgres(url,options)
const users = [randomUUID(),randomUUID()]
const checks: string[] = []
const identity = <T>(connection: typeof first,userId: string,scope: string,action: (sql: Transaction) => Promise<T>) => connection.begin(async sql => {
  await sql`set local role aigc_api`
  await sql`select set_config('aigc.user_id',${userId},true),set_config('aigc.scope',${scope},true),set_config('aigc.email','',true)`
  return action(sql)
}) as Promise<T>

try {
  const [existing] = await admin`select exists(select 1 from pg_namespace where nspname in ('aigc','auth')) as occupied`
  assert.equal(existing.occupied,false,'只允许初始化空白独立库；检测到业务 schema，停止执行')
  const [tables] = await admin`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','f')) as occupied`
  assert.equal(tables.occupied,false,'独立测试库必须没有现有业务表，停止执行')
  await bootstrapImageTestDatabase(sql => admin.unsafe(sql),users)
  for (const userId of users) for (const scope of ['local','preview','production']) {
    await admin`insert into aigc.credit_accounts(user_id,scope,balance) values(${userId},${scope},1000)`
  }
  const [[pidA],[pidB]] = await Promise.all([first`select pg_backend_pid() as pid`,second`select pg_backend_pid() as pid`])
  assert.notEqual(pidA.pid,pidB.pid)
  process.env.AIGC_DATABASE_URL = url
  process.env.AIGC_DB_LOCAL = local ? 'true' : 'false'
  process.env.AIGC_RUNTIME_SCOPE = 'local'
  process.env.VERCEL_ENV = 'development'
  process.env.AIGC_IMAGE_MOCK_PROVIDER = 'true'
  process.env.IMAGE_BACKGROUND_SUBMIT_ENABLED = 'true'
  delete process.env.IMAGE_MOCK_DELAY_MS
  const user = { id: users[0],email: 'stage2@example.invalid',suggestedName: '测试',avatarUrl: null,providers: ['email'] }
  const objects = new Map<string,{ bytes: Uint8Array;contentType: string }>()
  let submitted = 0
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>(resolve => { entered = resolve })
  const wait = new Promise<void>(resolve => { release = resolve })
  const provider = createMockImageProvider({ submit: async () => { submitted += 1; entered(); await wait; return { providerTaskId: 'test-original' } } })
  const runtime: ImageJobRuntime = { ...defaultImageJobRuntime(),log: () => undefined,providerFor: () => provider,
    putObject: async (key,bytes,contentType) => { objects.set(key,{ bytes,contentType }) },
    getObject: async key => { const object = objects.get(key); if (!object) throw new Error('对象不存在'); return object },
    signRead: async key => ({ url: `https://storage.test/${key}`,expiresAt: Date.now() + 900_000 }),
    crop: async bytes => ({ bytes: new Uint8Array(bytes),width: 1,height: 1,mimeType: 'image/png',cropped: false }),
  }
  const requestId = randomUUID()
  const submitting = submitImageTask(user,{ capability: 'text_to_image',requestId,modelProfileId: 'mock:image-stage2',
    params: { prompt: '后台协议测试',count: 1,resolution: '1k',size: { width: 1024,height: 1024 } } },runtime)
  await started
  const [job] = await admin`select * from aigc.image_jobs where request_id=${requestId}`
  const leaseContender = await identity(first,user.id,'local',sql => createSqlStore(sql,user.id).tryAcquireLease(job.id,new Date(Date.now()+120_000)))
  assert.equal(leaseContender,undefined)
  const workerContender = await identity(second,'','local',sql => sql`select * from aigc.claim_due_image_job('local')`)
  assert.equal(workerContender.length,0)
  const snapshot = await loadImageTask(user,job.id,runtime)
  assert.equal(snapshot?.id,job.id)
  assert.equal(submitted,1)
  const [transactions] = await admin`select count(*)::int as count from pg_stat_activity where datname=current_database()
    and state='idle in transaction' and pid<>pg_backend_pid()`
  assert.equal(transactions.count,0,'供应商等待时不能持有数据库事务')
  release()
  await submitting
  const [reserved] = await admin`select count(*)::int as count from aigc.credit_ledger where job_id=${job.id} and kind='reserve'`
  assert.equal(reserved.count,1)
  checks.push('F01 原 POST、GET、第二连接维护互斥，提交和预扣各一次；外部等待无事务')

  // 模拟浏览器断开：此后只调用维护，不调用用户任务 GET。
  await admin`update aigc.image_jobs set next_poll_at=now()-interval '1 second' where id=${job.id}`
  const report = await maintainImageJobs(runtime)
  assert.equal(report.failed,0)
  const [completed] = await admin`select status,billing_state,credits_charged from aigc.image_jobs where id=${job.id}`
  assert.equal(completed.status,'succeeded')
  assert.equal(completed.billing_state,'settled')
  assert.equal(completed.credits_charged,1)
  assert.equal(objects.size,1)
  assert.equal(submitted,1)
  const [settled] = await admin`select count(*)::int as count from aigc.credit_ledger where job_id=${job.id} and kind='settle'`
  assert.equal(settled.count,1)
  checks.push('无用户 GET 时维护独立转存 Mock 图片并结算一次')

  const jobId = randomUUID(); const oldToken = randomUUID(); const attemptId = randomUUID()
  await identity(first,user.id,'local',async sql => {
    await createSqlBilling(sql).reserve({ userId: user.id,jobId,amount: 1,meta: {} })
    const store = createSqlStore(sql,user.id)
    const row = await store.insertJob({ id: jobId,requestId: randomUUID(),fingerprint: 'test',capability: 'text_to_image',
      modelProfileId: 'mock:image-stage2',provider: 'mock',params: {},providerParams: {},warnings: [],requestedCount: 1,
      creditsReserved: 1,billingState: 'reserved',deadlineAt: new Date(Date.now()+300_000),nextPollAt: new Date(0),initialLease: true })
    await store.insertItems(row,1)
  })
  await admin`update aigc.image_jobs set lease_token=${oldToken},lease_until=now()-interval '1 second' where id=${jobId}`
  const newer = await identity(second,user.id,'local',sql => createSqlStore(sql,user.id).tryAcquireLease(jobId,new Date(Date.now()+120_000)))
  assert.ok(newer?.lease_token)
  await identity(second,user.id,'local',async sql => {
    const store = createSqlStore(sql,user.id)
    assert.ok(await store.assertLease(jobId,newer.lease_token!))
    await store.updateItem(jobId,0,{ status: 'processing',progress: 80 })
  })
  await assert.rejects(identity(first,user.id,'local',async sql => {
    await sql`select set_config('aigc.image_lease_token',${oldToken},true)`
    await sql`update aigc.image_job_items set progress=10 where job_id=${jobId}`
  }),/租约已失效/)
  await assert.rejects(identity(first,user.id,'local',async sql => {
    await sql`select set_config('aigc.image_lease_token',${oldToken},true)`
    await createSqlBilling(sql).release(jobId)
  }),/租约已失效/)
  assert.equal((await admin`select progress from aigc.image_job_items where job_id=${jobId}`)[0].progress,80)
  checks.push('F02 两连接过期重领后拒绝旧进度与旧结算，保留进度 80')

  // 迟到回执只能补原意图，不需要旧租约；新持有者读取同一凭据。
  await admin`insert into aigc.image_job_attempts(id,job_id,user_id,scope,kind,ordinals) values(${attemptId},${jobId},${user.id},'local','submit',array[0])`
  await identity(first,user.id,'local',sql => createSqlStore(sql,user.id).recordSubmission(attemptId,
    { provider_task_id: 'late-original',outcome: 'accepted',error_code: null,error_message: null,retryable: false }))
  const receipts = await identity(second,user.id,'local',sql => createSqlStore(sql,user.id).listAttempts(jobId))
  assert.equal(receipts[0].provider_task_id,'late-original')
  await admin`update aigc.image_jobs set status='failed',billing_state='released',lease_until=null,lease_token=null where id=${jobId}`
  checks.push('迟到回执由第二连接读取，旧执行者未改变任务或账本')

  // 跨实例上限与视频隔离：六个测试候选分属两账号，仅四份后台租约。
  const capacityIds: string[] = []
  for (let index = 0; index < 6; index += 1) {
    const id = randomUUID();capacityIds.push(id)
    await admin`insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,
      params,provider_params,requested_count,status,billing_state,deadline_at)
      values(${id},${users[index%2]},'preview',${randomUUID()},'test','text_to_image','mock:image-stage2','mock','{}','{}',1,'queued','none',now()+interval '5 minutes')`
  }
  const claims = []
  for (let index = 0; index < 3; index += 1) claims.push(...await Promise.all([
    identity(first,'','preview',sql => sql`select * from aigc.claim_due_image_job('preview')`),
    identity(second,'','preview',sql => sql`select * from aigc.claim_due_image_job('preview')`),
  ]))
  assert.equal(claims.flat().length,4)
  assert.equal(new Set(claims.flat().map(row => row.id)).size,4)
  checks.push('双实例领取总上限四项，领取互斥')
  await admin`update aigc.image_jobs set lease_until=null,lease_token=null,lease_owner=null where id=any(${capacityIds}::uuid[])`

  let unlock!: () => void; let locked!: () => void
  const lockedSignal = new Promise<void>(resolve => { locked = resolve })
  const unlockSignal = new Promise<void>(resolve => { unlock = resolve })
  const held = first.begin(async sql => { await sql`select id from aigc.image_jobs where id=${capacityIds[0]} for update`;locked();await unlockSignal })
  await lockedSignal
  const skipped = await identity(second,'','preview',sql => sql`select * from aigc.claim_due_image_job('preview')`)
  assert.equal(skipped.length,1)
  assert.notEqual(skipped[0].id,capacityIds[0])
  unlock();await held
  checks.push('FOR UPDATE SKIP LOCKED 跳过另一真实连接持有的行锁')

  // 原截止不延长；租约保护与到期收口共用同一行锁，三环境分开结算。
  await admin`update aigc.image_jobs set deadline_at=now()-interval '1 minute',lease_until=null,lease_token=null where id=any(${capacityIds}::uuid[])`
  const localBefore = (await admin`select status from aigc.image_jobs where id=${job.id}`)[0].status
  await identity(second,'','preview',sql => sql`select aigc.expire_overdue_image_jobs()`)
  assert.equal((await admin`select status from aigc.image_jobs where id=${job.id}`)[0].status,localBefore)
  checks.push('到期批次限定当前环境，终态与原账本互不干扰')

  // 校验完整 runner 在 SQL 下运行，结果描述包含独立转存尝试。
  const completedAttempts = await identity(first,user.id,'local',sql => createSqlStore(sql,user.id).listAttempts(job.id))
  assert.equal(completedAttempts.filter(attempt => attempt.kind==='transfer').length,1)
  assert.ok([...objects.keys()][0].includes(`/local/${job.id}/0/`))
  assert.equal(Buffer.compare(Buffer.from([...objects.values()][0].bytes),Buffer.from(MOCK_PNG_1X1)),0)
  const execution = sqlImageExecution(user.id,user.email)
  const current = await execution.transaction(async store => ({ job: (await store.findById(job.id))!,items: await store.listItems(job.id) }))
  assert.ok(current.job)
  await assert.rejects(advanceImageClaim(current,{ ...runtime,execution }),/租约已失效/)
  checks.push('已发布对象拥有转存凭据；终态任务无有效租约不能再次执行')

  const [version] = await admin`select version() as version`
  console.log(JSON.stringify({ passed: true,database: String(version.version).split(' on ')[0],connections: 2,checks,
    supplier: 'Mock',storage: '内存对象存储',previewVerified: false },null,2))
} finally {
  await Promise.allSettled([first.end(),second.end(),admin.end(),
    ...(process.env.AIGC_DATABASE_URL === url ? [database().end()] : [])])
}
