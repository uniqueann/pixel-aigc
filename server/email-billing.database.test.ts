import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const owner = '00000000-0000-4000-8000-000000000091'
const other = '00000000-0000-4000-8000-000000000092'
let db: PGlite
const q = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, args)).rows
async function asUser<T>(action: () => Promise<T>, user = owner, scope = 'local') {
  await db.exec('begin; set local role aigc_api')
  try {
    await q("select set_config('aigc.user_id',$1,true),set_config('aigc.scope',$2,true)", [user, scope])
    const result = await action(); await db.exec('commit'); return result
  } catch (error) { await db.exec('rollback'); throw error }
}
const files = [
  '20260908094310_aigc_foundation.sql', '20260923015953_aigc_accounts.sql', '20260923020155_aigc_project_compat.sql',
  '20260923102829_aigc_email_byok.sql', '20260928120000_aigc_image_jobs.sql', '20260929100000_aigc_credits_and_sync_limits.sql',
  '20260929233436_aigc_credit_adjust.sql', '20260930115938_erase_transfer_metrics.sql', '20261004152128_aigc_credit_payments.sql',
  '20261004222317_aigc_free_sync_credit_ledger.sql', '20261005034700_aigc_checkout_account_lock.sql',
  '20261008161051_credit_discount_codes.sql', '20261009105115_email_platform_models.sql',
]
beforeAll(async () => {
  db = new PGlite()
  await db.exec('create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key)')
  for (const file of files) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  for (const id of [owner, other]) {
    await q('insert into auth.users values($1)', [id]); await q('insert into aigc.members(user_id) values($1)', [id])
  }
}, 30000)
afterAll(() => db.close())
async function createTask(amount = 1, model = 'deepseek:deepseek-flash', request = randomUUID()) {
  const id = randomUUID()
  await q(`insert into aigc.email_tasks(id,user_id,scope,request_id,request_fingerprint,params,model_profile_id,status,price_version,credits_reserved,billing_state)
    values($1,current_setting('aigc.user_id')::uuid,current_setting('aigc.scope'),$2,'fingerprint','{"sourceText":"私密正文","operation":"reply"}',$3,'processing','aigc-email-v1',$4,'reserved')`, [id, request, model, amount])
  return { id, request, result: (await q('select aigc.reserve_email_credits($1) as result', [id]))[0].result as Record<string, unknown> }
}
async function finish(id: string, text: string | null = '完整回复') {
  return (await q('select aigc.finish_email_task($1,$2,null,$3,$4,null) as task', [id, text, text ? null : 'PROVIDER_UNAVAILABLE', text ? null : '平台故障']))[0].task as Record<string, unknown> | null
}
async function balance() { return Number((await q('select balance from aigc.credit_accounts'))[0].balance) }

describe('邮件积分事务与长期幂等', () => {
  it('成功只扣一次，重复预扣和收口不会重复影响余额，流水不包含正文', async () => {
    await asUser(async () => {
      const created = await createTask()
      expect(created.result).toEqual({ reserved: true })
      const before = await balance()
      await q('select aigc.reserve_email_credits($1)', [created.id])
      expect(await balance()).toBe(before)
      expect(await finish(created.id)).toMatchObject({ status: 'succeeded', credits_charged: 1, billing_state: 'settled' })
      await finish(created.id, null)
      expect(await balance()).toBe(before)
      const ledger = await q('select kind,delta,meta from aigc.credit_ledger where job_id=$1', [created.id])
      expect(ledger.map(row => row.kind)).toEqual(['reserve', 'settle'])
      expect(JSON.stringify(ledger)).not.toContain('私密正文')
    })
  })
  it('供应商失败全额返还，重复退款和迟到成功不能再次结算', async () => {
    await asUser(async () => {
      const before = await balance(); const created = await createTask(3, 'ai-gateway:gemini-3.8-flash')
      expect(await balance()).toBe(before - 3)
      expect(await finish(created.id, null)).toMatchObject({ status: 'failed', credits_charged: 0, billing_state: 'refunded' })
      await finish(created.id); await finish(created.id, null)
      expect(await balance()).toBe(before)
      expect((await q("select kind from aigc.credit_ledger where job_id=$1 and kind='refund'", [created.id])).length).toBe(1)
    })
  })
  it('额度不足时整个创建事务回滚，账户冻结阻止预扣', async () => {
    await q("update aigc.credit_accounts set balance=0 where user_id=$1 and scope='local'", [other])
    await asUser(async () => { await q('select aigc.ensure_credit_account($1)', [other]) }, other)
    await q("update aigc.credit_accounts set balance=0 where user_id=$1 and scope='local'", [other])
    const request = randomUUID()
    await expect(asUser(async () => {
      const created = await createTask(1, 'deepseek:deepseek-flash', request)
      expect(created.result).toMatchObject({ insufficient: true, balance: 0 }); throw new Error('余额不足')
    }, other)).rejects.toThrow('余额不足')
    expect(await q('select id from aigc.email_tasks where request_id=$1', [request])).toEqual([])
    await q("update aigc.credit_accounts set payment_blocked=true where user_id=$1 and scope='local'", [other])
    await expect(asUser(async () => {
      expect((await createTask()).result).toEqual({ blocked: true }); throw new Error('账户冻结')
    }, other)).rejects.toThrow('账户冻结')
  })
  it('超时由维护返还，不依赖用户访问，且不影响另一环境', async () => {
    const created = await asUser(() => createTask())
    const preview = await asUser(() => createTask(), owner, 'preview')
    await q("update aigc.email_tasks set deadline_at=now()-interval '1 minute' where id in ($1,$2)", [created.id, preview.id])
    await db.exec('begin;set local role aigc_api')
    await q("select set_config('aigc.scope','local',true),set_config('aigc.user_id','',true)")
    expect((await q("select aigc.expire_email_tasks('local') as n"))[0].n).toBe(1)
    await db.exec('commit')
    expect((await q('select status,billing_state from aigc.email_tasks where id=$1', [created.id]))[0]).toEqual({ status: 'failed', billing_state: 'refunded' })
    expect((await q('select status from aigc.email_tasks where id=$1', [preview.id]))[0].status).toBe('processing')
  })
  it('任务删除后原请求仍由流水阻止再预扣', async () => {
    await asUser(async () => {
      const created = await createTask(); await finish(created.id)
      const before = await balance()
      await q('delete from aigc.email_tasks where id=$1', [created.id])
      const recreated = await createTask(1, 'deepseek:deepseek-flash', created.request)
      expect(recreated.result).toEqual({ expired: true })
      expect(await balance()).toBe(before)
      await q('delete from aigc.email_tasks where id=$1', [recreated.id])
    })
  })
  it('用户和环境隔离，内部收口函数不可被应用角色直接调用', async () => {
    const created = await asUser(() => createTask())
    await asUser(async () => {
      expect(await q('select id from aigc.email_tasks where id=$1', [created.id])).toEqual([])
      expect(await finish(created.id)).toBeNull()
    }, other)
    await asUser(async () => expect(await finish(created.id)).toBeNull(), owner, 'production')
    await expect(asUser(() => q('select aigc.finish_email_for_owner($1,$2,$3,null,null,null,null,null)', [created.id, owner, 'local']))).rejects.toThrow(/permission denied/)
  })
  it('每日清理先退款，再删除内容，保留流水和旧免费任务语义', async () => {
    const created = await asUser(() => createTask())
    await q("update aigc.email_tasks set deadline_at=now()-interval '1 minute',expires_at=now()-interval '1 second' where id=$1", [created.id])
    await db.exec('begin;set local role aigc_api')
    await q("select set_config('aigc.scope','local',true),set_config('aigc.user_id','',true)")
    await q("select aigc.purge_expired_email_tasks('local')")
    await db.exec('commit')
    expect(await q('select id from aigc.email_tasks where id=$1', [created.id])).toEqual([])
    expect((await q("select kind from aigc.credit_ledger where job_id=$1 and kind='refund'", [created.id])).length).toBe(1)
    await asUser(async () => {
      const id = randomUUID(); await q(`insert into aigc.email_tasks(id,user_id,scope,request_id,request_fingerprint,params,model_profile_id,status)
        values($1,$2,'local',$3,'old','{}','deepseek:deepseek-flash','processing')`, [id, owner, randomUUID()])
      expect(await finish(id)).toMatchObject({ billing_state: 'legacy_free', credits_charged: 0 })
      expect(await q('select id from aigc.credit_ledger where job_id=$1', [id])).toEqual([])
    })
  })
})
