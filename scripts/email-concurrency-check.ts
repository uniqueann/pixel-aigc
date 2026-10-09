import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

// 仅允许空的本地测试数据库；不会连接生产或读取真实供应商凭据。
const raw = process.env.EMAIL_TEST_DATABASE_URL
if (!raw) throw new Error('请提供 EMAIL_TEST_DATABASE_URL，指向空的本地 pixel_email_test 数据库')
const url = new URL(raw)
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.startsWith('/pixel_email_test'))
  throw new Error('并发验收仅允许本地 pixel_email_test 数据库')
const admin = postgres(raw, { ssl: false, prepare: false, max: 3 })
const namespace = await admin`select to_regnamespace('aigc') as existing`
if (namespace[0].existing) { await admin.end(); throw new Error('数据库不是空测试库，请使用新的数据库') }
await admin.unsafe(`do $$ begin
  if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
  if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
end $$; create schema auth; create table auth.users(id uuid primary key)`)
for (const file of [
  '20260908094310_aigc_foundation.sql', '20260923015953_aigc_accounts.sql', '20260923020155_aigc_project_compat.sql',
  '20260923102829_aigc_email_byok.sql', '20260928120000_aigc_image_jobs.sql', '20260929100000_aigc_credits_and_sync_limits.sql',
  '20260929233436_aigc_credit_adjust.sql', '20260930115938_erase_transfer_metrics.sql', '20261004152128_aigc_credit_payments.sql',
  '20261004222317_aigc_free_sync_credit_ledger.sql', '20261005034700_aigc_checkout_account_lock.sql',
  '20261008161051_credit_discount_codes.sql', '20261009105115_email_platform_models.sql',
]) {
  // 角色属于整个本地集群，允许在同一集群的新空库重复运行验收。
  const migration = readFileSync(`supabase/migrations/${file}`, 'utf8').replace(
    'create role aigc_api nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;',
    () => 'do $$ begin create role aigc_api nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; exception when duplicate_object then null; end $$;')
  await admin.unsafe(migration)
}
const owner = randomUUID()
await admin`insert into auth.users values(${owner})`
await admin`insert into aigc.members(user_id) values(${owner})`
Object.assign(process.env, { AIGC_DATABASE_URL: raw, AIGC_DB_LOCAL: 'true', AIGC_RUNTIME_SCOPE: 'local',
  EMAIL_ASSIST_ENABLED: 'true', DEEPSEEK_EMAIL_ENABLED: 'true', DEEPSEEK_API_KEY: 'local-test-placeholder', CRON_SECRET: 'local-test-placeholder' })
const { handleEmailTaskRoute } = await import('../server/email-tasks.js')
const { database, withIdentity } = await import('../server/db.js')
const user = { id: owner, email: 'local-test@example.invalid' } as Parameters<typeof handleEmailTaskRoute>[0]
const body = (requestId = randomUUID()) => ({ capability: 'email_assist', requestId, modelProfileId: 'deepseek:deepseek-flash',
  priceVersion: 'aigc-email-v1', params: { sourceText: '测试邮件', operation: 'reply', language: 'zh' } })
const submit = (input = body()) => handleEmailTaskRoute(user, 'POST', ['tasks'], input, new URLSearchParams())
const reply = () => new Response(JSON.stringify({ id: 'local-generation', choices: [{ finish_reason: 'stop', message: { content: '测试完整回复' } }] }), { status: 200 })
let calls = 0
const originalFetch = globalThis.fetch
const resetBalance = async (amount: number) => {
  await withIdentity(owner, user.email, sql => sql`select aigc.ensure_credit_account(${owner})`)
  await admin`update aigc.credit_accounts set balance=${amount} where user_id=${owner} and scope='local'`
}
const balance = async () => Number((await admin`select balance from aigc.credit_accounts where user_id=${owner} and scope='local'`)[0].balance)
try {
  globalThis.fetch = async () => { calls++; return reply() }
  await resetBalance(1)
  const results = await Promise.allSettled([submit(), submit()])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal(results.filter(result => result.status === 'rejected').length, 1)
  assert.equal(calls, 1); assert.equal(await balance(), 0)
  console.log('通过：两个邮件同时消费最后一积分，仅一次模型调用与扣费')

  await resetBalance(1); calls = 0
  const repeated = body()
  await Promise.all([submit(repeated), submit(repeated)])
  assert.equal(calls, 1); assert.equal(await balance(), 0)
  const duplicates = await admin`select status,credits_charged from aigc.email_tasks where request_id=${repeated.requestId}`
  assert.equal(duplicates.length, 1); assert.equal(duplicates[0].credits_charged, 1)
  console.log('通过：同请求并发重放只创建一个任务、调用一次、扣一次')
  const [completed] = await admin`select id from aigc.email_tasks where request_id=${repeated.requestId}`
  await handleEmailTaskRoute(user, 'DELETE', ['tasks', completed.id], null, new URLSearchParams())
  await assert.rejects(handleEmailTaskRoute(user, 'GET', ['tasks', completed.id], null, new URLSearchParams()),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'TASK_EXPIRED'))
  await assert.rejects(submit(repeated),
    (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'TASK_EXPIRED'))
  assert.equal(calls, 1)
  console.log('通过：删除正文后任务查询与请求重放均返回过期，不再次调用')

  await resetBalance(1)
  let started!: () => void, release!: (response: Response) => void
  const arrived = new Promise<void>(resolve => { started = resolve })
  globalThis.fetch = async () => { started(); return new Promise<Response>(resolve => { release = resolve }) }
  const racing = body(); const pending = submit(racing)
  await arrived
  await admin`update aigc.email_tasks set deadline_at=now()-interval '1 second' where request_id=${racing.requestId}`
  const maintenance = admin.begin(async sql => {
    await sql`set local role aigc_api`
    await sql`select set_config('aigc.scope','local',true),set_config('aigc.user_id','',true)`
    return sql`select aigc.expire_email_tasks('local')`
  })
  release(reply()); await Promise.all([pending, maintenance])
  assert.equal(await balance(), 1)
  const [raceTask] = await admin`select id,status,billing_state,credits_charged from aigc.email_tasks where request_id=${racing.requestId}`
  assert.equal(raceTask.status, 'failed'); assert.equal(raceTask.billing_state, 'refunded'); assert.equal(raceTask.credits_charged, 0)
  const refunds = await admin`select id from aigc.credit_ledger where job_id=${raceTask.id} and kind='refund'`
  assert.equal(refunds.length, 1)
  console.log('通过：迟到成功与超时补偿竞争，退款一次且不再次结算')

  await resetBalance(2)
  globalThis.fetch = async () => reply()
  const imageJob = randomUUID(); const mail = body()
  const [imageReserved] = await Promise.all([
    withIdentity(owner, user.email, sql => sql`select aigc.reserve_image_credits(${owner},${imageJob},2,'{}') as reserved`),
    submit(mail).catch(error => { assert.equal(error.code, 'INSUFFICIENT_CREDITS'); return null }),
  ])
  const mailRows = await admin`select credits_charged from aigc.email_tasks where request_id=${mail.requestId}`
  const spent = (imageReserved[0].reserved ? 2 : 0) + Number(mailRows[0]?.credits_charged ?? 0)
  assert.ok(spent <= 2); assert.equal(await balance(), 2 - spent)
  assert.equal(Number(imageReserved[0].reserved) + Number(mailRows.length > 0), 1)
  console.log('通过：图片与邮件同时预扣共享余额，不透支')
} finally {
  globalThis.fetch = originalFetch
  await database().end(); await admin.end()
}
