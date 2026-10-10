import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

let db: PGlite
const query = async (sql: string, args: unknown[] = []) => (await db.query<Record<string, unknown>>(sql, args)).rows
const files = [
  '20260908094310_aigc_foundation.sql', '20260923015953_aigc_accounts.sql', '20260923020155_aigc_project_compat.sql',
  '20260923102829_aigc_email_byok.sql', '20260928120000_aigc_image_jobs.sql', '20260929100000_aigc_credits_and_sync_limits.sql',
  '20260929233436_aigc_credit_adjust.sql', '20260930115938_erase_transfer_metrics.sql', '20261004152128_aigc_credit_payments.sql',
  '20261004222317_aigc_free_sync_credit_ledger.sql', '20261005034700_aigc_checkout_account_lock.sql',
  '20261008161051_credit_discount_codes.sql', '20261009105115_email_platform_models.sql',
]
async function asUser<T>(user: string, scope: string, action: () => Promise<T>) {
  await db.exec('begin; set local role aigc_api')
  try {
    await query("select set_config('aigc.user_id',$1,true),set_config('aigc.scope',$2,true)", [user, scope])
    const result = await action(); await db.exec('commit'); return result
  } catch (error) { await db.exec('rollback'); throw error }
}
async function member() {
  const id = randomUUID()
  await query('insert into auth.users values($1)', [id])
  await query('insert into aigc.members(user_id) values($1)', [id])
  return id
}
async function ledger(user: string, kind: string, charged: number | null, meta = {}, scope = 'local') {
  await query(`insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,charged,idempotency_key,meta)
    values($1,$2,$3,0,30,$4,$5,$6)`, [user, scope, kind, charged, randomUUID(), JSON.stringify(meta)])
}
const events = (user: string, scope = 'local') => query('select event,tool from aigc.user_activation_events where user_id=$1 and scope=$2 order by event', [user, scope])
let historical: string
beforeAll(async () => {
  db = new PGlite()
  await db.exec('create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key)')
  for (const file of files) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  historical = await member()
  await asUser(historical, 'local', () => query('select aigc.ensure_credit_account($1)', [historical]))
  await ledger(historical, 'settle', 0, { free: true, tool: 'bg-remove' })
  await db.exec(readFileSync('supabase/migrations/20261010065807_new_user_activation.sql', 'utf8'))
}, 30000)
afterAll(() => db.close())

describe('新用户事件数据库验收', () => {
  it('历史注册和成功只回填真实账本时间，不伪造首次上传', async () => {
    expect(await events(historical)).toEqual([
      { event: 'first_generation_success', tool: 'bg-remove' }, { event: 'registration_complete', tool: null },
    ])
    const [result] = await query(`select e.occurred_at=l.created_at as same_time from aigc.user_activation_events e
      join aigc.credit_ledger l on l.user_id=e.user_id and l.scope=e.scope and l.idempotency_key='initial'
      where e.user_id=$1 and e.event='registration_complete'`, [historical])
    expect(result.same_time).toBe(true)
    expect((await query('select credit_notice_seen from aigc.user_welcome_state where user_id=$1', [historical]))[0].credit_notice_seen).toBe(true)
  })
  it('新钱包真实赠送 30，注册事件和首次上传只记录一次，环境分开', async () => {
    const user = await member()
    await asUser(user, 'local', async () => {
      expect((await query('select aigc.ensure_credit_account($1) as balance', [user]))[0].balance).toBe(30)
      await query('select aigc.ensure_credit_account($1)', [user])
      expect((await query("select aigc.record_first_upload('bg-remove') as recorded"))[0].recorded).toBe(true)
      expect((await query("select aigc.record_first_upload('repaint') as recorded"))[0].recorded).toBe(false)
    })
    expect(await events(user)).toEqual([{ event: 'first_upload', tool: 'bg-remove' }, { event: 'registration_complete', tool: null }])
    await asUser(user, 'preview', () => query("select aigc.record_first_upload('email-batch')"))
    expect(await events(user, 'preview')).toEqual([{ event: 'first_upload', tool: 'email-batch' }])
  })
  it('预扣、退款和空结果不计成功，免费抠图成功计一次', async () => {
    const user = await member()
    await ledger(user, 'reserve', null)
    await ledger(user, 'refund', 0)
    await ledger(user, 'settle', 0)
    expect(await events(user)).toEqual([])
    await ledger(user, 'settle', 0, { free: true, tool: 'bg-remove' })
    await ledger(user, 'settle', 3, { capability: 'image_edit' })
    expect(await events(user)).toEqual([{ event: 'first_generation_success', tool: 'bg-remove' }])
  })
  it('事件随业务事务回滚，统计写入失败不会破坏成功结算', async () => {
    const user = await member()
    await db.exec('begin')
    await ledger(user, 'settle', 2, { capability: 'image_edit' })
    await db.exec('rollback')
    expect(await events(user)).toEqual([])
    await db.exec('begin; alter table aigc.user_activation_events rename to temporarily_unavailable_events')
    await ledger(user, 'settle', 2)
    expect((await query('select kind from aigc.credit_ledger where user_id=$1', [user]))[0].kind).toBe('settle')
    await db.exec('rollback')
  })
  it('关闭统计后停止上传和后续成功事件，欢迎状态仍能保存', async () => {
    const user = await member()
    await asUser(user, 'local', async () => {
      await query(`insert into aigc.user_welcome_state(user_id,scope,analytics_enabled,credit_notice_seen,starter_card_dismissed)
        values($1,'local',false,true,true)`, [user])
      expect((await query("select aigc.record_first_upload('bg-remove') as recorded"))[0].recorded).toBe(false)
    })
    await ledger(user, 'settle', 0, { free: true })
    expect(await events(user)).toEqual([])
    expect((await query('select credit_notice_seen,starter_card_dismissed from aigc.user_welcome_state where user_id=$1', [user]))[0])
      .toEqual({ credit_notice_seen: true, starter_card_dismissed: true })
  })
  it('RLS 隔离账号与环境，客户端不能伪造注册和成功事件，停用账号拒绝写入', async () => {
    const user = await member(), other = await member()
    await asUser(user, 'local', () => query("select aigc.record_first_upload('bg-remove')"))
    expect(await asUser(other, 'local', () => query('select * from aigc.user_activation_events'))).toEqual([])
    expect(await asUser(user, 'production', () => query('select * from aigc.user_activation_events'))).toEqual([])
    await expect(asUser(user, 'local', () => query(`insert into aigc.user_activation_events(user_id,scope,event)
      values($1,'local','first_generation_success')`, [user]))).rejects.toThrow(/permission denied/)
    await expect(asUser(other, 'local', () => query(`insert into aigc.user_welcome_state(user_id,scope) values($1,'local')`, [user])))
      .rejects.toThrow(/row-level security/)
    await query("update aigc.members set status='disabled' where user_id=$1", [user])
    await expect(asUser(user, 'local', () => query("select aigc.record_first_upload('bg-remove')"))).rejects.toThrow('使用事件无效')
    expect((await query("select has_function_privilege('anon','aigc.record_first_upload(text)','EXECUTE') as allowed"))[0].allowed).toBe(false)
  })
})
