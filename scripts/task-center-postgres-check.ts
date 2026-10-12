import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { bootstrapImageTestDatabase } from '../server/image-jobs/database-fixture.js'
import { database, type Transaction } from '../server/db.js'
import {
  taskRepository,
  taskSummary,
} from '../server/task-center/repository.js'
import {
  queryPort,
  withTaskCenterRead,
  writePresentation,
} from '../server/task-center/service.js'

// 仅允许空白独立数据库；不复用业务库，不清空原有数据。
const url = process.env.TASK_CENTER_TEST_DATABASE_URL
if (!url || process.env.TASK_CENTER_TEST_DATABASE_CONFIRM !== 'isolated')
  throw new Error(
    '请配置独立库 TASK_CENTER_TEST_DATABASE_URL，并确认 TASK_CENTER_TEST_DATABASE_CONFIRM=isolated',
  )
const parsed = new URL(url)
if (!['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname))
  throw new Error('本验收脚本只连接本地独立 PostgreSQL')
const admin = postgres(url, { max: 1, prepare: false }),
  other = postgres(url, { max: 1, prepare: false })
const users = [randomUUID(), randomUUID()],
  checks: string[] = []
process.env.AIGC_DATABASE_URL = url
process.env.AIGC_DB_LOCAL = 'true'
process.env.AIGC_RUNTIME_SCOPE = 'preview'
process.env.VERCEL_ENV = 'development'
const user = { id: users[0], email: 'task-center@example.invalid' }
async function identity<T>(
  owner: string,
  scope: string,
  action: (sql: Transaction) => Promise<T>,
) {
  return other.begin(async (sql) => {
    await sql`set local role aigc_api`
    await sql`select set_config('aigc.user_id',${owner},true),set_config('aigc.scope',${scope},true)`
    return action(sql)
  }) as Promise<T>
}
try {
  const [occupied] =
    await admin`select exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname not like 'pg_%' and n.nspname<>'information_schema' and c.relkind in ('r','p','f')) as yes`
  assert.equal(occupied.yes, false, '仅初始化空白数据库')
  await bootstrapImageTestDatabase((s) => admin.unsafe(s), users)
  const image = randomUUID(),
    request = randomUUID(),
    sync = randomUUID(),
    mail = randomUUID()
  await admin`insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,params,provider_params,requested_count,status,credits_reserved,billing_state,deadline_at,next_poll_at)
 values(${image},${user.id},'preview',${request},'fixture','variation','fixture','mock','{}','{}',2,'succeeded',0,'none',now()-interval '1 day',now())`
  await admin`insert into aigc.image_job_items(job_id,user_id,scope,ordinal,status,result_object_key) values(${image},${user.id},'preview',0,'succeeded',${`generated/${user.id}/preview/${image}/0/a.png`}),(${image},${user.id},'preview',1,'expired',null)`
  await admin`insert into aigc.sync_credit_jobs(id,user_id,scope,operation,fingerprint,price_version,credits_reserved,state,deadline_at) values(${sync},${user.id},'preview','bg-remove','fixture','v',0,'reserved',now()-interval '1 day')`
  await admin`insert into aigc.email_tasks(id,user_id,scope,request_id,request_fingerprint,params,status,result_text,billing_state,model_profile_id) values(${mail},${user.id},'preview',${randomUUID()},'fixture','{}','succeeded','原结果','legacy_free','fixture')`
  const before =
    await admin`select (select jsonb_agg(to_jsonb(j)) from aigc.image_jobs j) as images,(select jsonb_agg(to_jsonb(j)) from aigc.sync_credit_jobs j) as syncs,(select count(*)::int from aigc.credit_ledger) as ledger`
  await withTaskCenterRead(user, async (repo) => {
    assert.equal((await repo.sidebar()).items.length, 3)
    await repo.history({})
    await repo.get('image_job', request, true)
    await repo.get('sync_credit', sync)
  })
  assert.deepEqual(
    await admin`select (select jsonb_agg(to_jsonb(j)) from aigc.image_jobs j) as images,(select jsonb_agg(to_jsonb(j)) from aigc.sync_credit_jobs j) as syncs,(select count(*)::int from aigc.credit_ledger) as ledger`,
    before,
  )
  await assert.rejects(
    withTaskCenterRead(user, (repo) =>
      repo.presentation('image_job', image, 'seen', 'v1:' + 'a'.repeat(32)),
    ),
    /read-only/,
  )
  checks.push('真实 READ ONLY 查询三源与到期预留，任务及账本保持不变')
  for (const owner of users)
    for (const scope of ['local', 'preview', 'production']) {
      if (owner === user.id && scope === 'preview') continue
      await assert.rejects(
        identity(owner, scope, (sql) =>
          taskRepository(queryPort(sql), owner, scope as 'preview').get(
            'image_job',
            image,
          ),
        ),
        (error) =>
          !!error &&
          typeof error === 'object' &&
          'status' in error &&
          error.status === 404,
      )
      await assert.rejects(
        identity(
          owner,
          scope,
          (sql) =>
            sql`insert into aigc.task_ui_state(user_id,scope,source_kind,source_id) values(${owner},${scope},'image_job',${image})`,
        ),
        /row-level security/,
      )
    }
  checks.push('应用角色两账号三环境读取及展示写入隔离')
  async function verifyPresentationRace(
    kind: 'image_job' | 'sync_credit',
    id: string,
    update: (sql: Transaction) => Promise<unknown>,
  ) {
    const old = await withTaskCenterRead(user, async (repo) =>
      taskSummary(await repo.get(kind, id)),
    )
    let locked!: () => void, release!: () => void
    const ready = new Promise<void>((resolve) => { locked = resolve }),
      gate = new Promise<void>((resolve) => { release = resolve })
    const background = admin.begin(async (sql) => {
      const table = kind === 'image_job' ? 'image_jobs' : 'sync_credit_jobs'
      await sql`select id from aigc.${sql(table)} where id=${id} for update`
      locked()
      await gate
      await update(sql)
    })
    await ready
    const presentation = writePresentation(user, kind, id, 'dismiss', old.outcomeVersion!)
    const rejection = assert.rejects(presentation, error =>
      !!error && typeof error === 'object' && 'status' in error && error.status === 409)
    let waiting = false
    try {
      // 实际观察原任务锁的等待；后台写回提交后，旧结果版本必须被拒绝。
      for (let i = 0; i < 100; i++) {
        const [row] = await other`select exists(select 1 from pg_stat_activity where datname=current_database() and wait_event_type='Lock') as waiting`
        if (row.waiting) { waiting = true; break }
        await new Promise(resolve => setTimeout(resolve, 20))
      }
    } finally {
      release()
      await background
      await rejection
    }
    assert.equal(waiting, true, '必须实际观察到展示连接等待原任务锁')
    const fresh = await withTaskCenterRead(user, async repo => taskSummary(await repo.get(kind, id)))
    assert.notEqual(old.outcomeVersion, fresh.outcomeVersion)
    assert.equal(fresh.dismissed, false)
    await writePresentation(user, kind, id, 'seen', fresh.outcomeVersion!)
  }
  await verifyPresentationRace('image_job', image, sql =>
    sql`update aigc.image_job_items set status='succeeded',result_object_key=${`generated/${user.id}/preview/${image}/1/b.png`} where job_id=${image} and ordinal=1`)
  checks.push('图片两连接写回与展示操作竞争，旧版本409，新结果仍可见')
  await admin`update aigc.sync_credit_jobs set state='settled',result=${admin.json({objectKey:'temporary/first.png',width:64,height:96,mimeType:'image/png'})}::jsonb where id=${sync}`
  const syncBefore = await admin`select to_jsonb(j) as data from aigc.sync_credit_jobs j where id=${sync}`
  for (const [kind,id] of [['sync_credit',sync],['email_task',mail]] as const) {
    const task = await withTaskCenterRead(user, async repo => taskSummary(await repo.get(kind,id)))
    assert.equal((await writePresentation(user,kind,id,'seen',task.outcomeVersion!)).seen,true)
    assert.equal((await writePresentation(user,kind,id,'dismiss',task.outcomeVersion!)).dismissed,true)
  }
  assert.deepEqual(await admin`select to_jsonb(j) as data from aigc.sync_credit_jobs j where id=${sync}`,syncBefore)
  assert.equal((await admin`select count(*)::int as n from aigc.credit_ledger`)[0].n,0)
  const [privileges] = await admin`select has_any_column_privilege('aigc_api','aigc.sync_credit_jobs','UPDATE') as sync_update,has_function_privilege('anon','aigc.lock_task_center_sync(uuid)','EXECUTE') as anon_execute,has_function_privilege('authenticated','aigc.lock_task_center_sync(uuid)','EXECUTE') as authenticated_execute`
  assert.deepEqual({...privileges},{sync_update:false,anon_execute:false,authenticated_execute:false})
  const syncTask = await withTaskCenterRead(user, async repo => taskSummary(await repo.get('sync_credit',sync)))
  for (const owner of users) for (const scope of ['local','preview','production']) {
    if (owner===user.id&&scope==='preview') continue
    await assert.rejects(identity(owner,scope,sql=>taskRepository(queryPort(sql),owner,scope as 'preview').presentation('sync_credit',sync,'seen',syncTask.outcomeVersion!)),
      error=>!!error&&typeof error==='object'&&'status' in error&&error.status===404)
  }
  checks.push('三源展示操作通过；同步原表及账本不变，原表写权限和客户端函数权限未开放')
  await verifyPresentationRace('sync_credit',sync,sql=>
    sql`update aigc.sync_credit_jobs set result=jsonb_set(result,'{objectKey}','"temporary/late.png"') where id=${sync}`)
  checks.push('同步受限函数实际持有原行锁；跨账号环境拒绝，两连接迟到结果竞争返回409')
  await admin`update aigc.task_ui_state set created_at=now()-interval '31 days' where scope='preview'`
  await admin`insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,params,provider_params,requested_count,status,credits_reserved,billing_state,deadline_at,next_poll_at)
 values(${randomUUID()},${user.id},'production',${randomUUID()},'fixture','variation','fixture','mock','{}','{}',1,'failed',0,'none',now(),now())`
  const [prod] =
    await admin`select id from aigc.image_jobs where scope='production'`
  await admin`insert into aigc.task_ui_state(user_id,scope,source_kind,source_id,created_at) values(${user.id},'production','image_job',${prod.id},now()-interval '31 days')`
  const tasksBeforePurge = await admin`select (select jsonb_agg(to_jsonb(j) order by id) from aigc.image_jobs j) as images,(select jsonb_agg(to_jsonb(j) order by id) from aigc.sync_credit_jobs j) as syncs,(select jsonb_agg(to_jsonb(j) order by id) from aigc.email_tasks j) as emails`
  await identity('', 'preview', (sql) => sql`select aigc.purge_task_ui_state()`)
  assert.equal(
    (
      await admin`select count(*)::int as n from aigc.task_ui_state where scope='preview'`
    )[0].n,
    0,
  )
  assert.equal(
    (
      await admin`select count(*)::int as n from aigc.task_ui_state where scope='production'`
    )[0].n,
    1,
  )
  assert.equal(
    (await admin`select count(*)::int as n from aigc.credit_ledger`)[0].n,
    0,
  )
  assert.deepEqual(await admin`select (select jsonb_agg(to_jsonb(j) order by id) from aigc.image_jobs j) as images,(select jsonb_agg(to_jsonb(j) order by id) from aigc.sync_credit_jobs j) as syncs,(select jsonb_agg(to_jsonb(j) order by id) from aigc.email_tasks j) as emails`,tasksBeforePurge)
  checks.push('展示清理仅影响指定环境；任务和账本不受影响')
  console.log(JSON.stringify({ ok: true, checks }, null, 2))
} finally {
  await Promise.all([admin.end(), other.end(), database().end()])
}
