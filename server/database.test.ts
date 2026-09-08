import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const alice = '00000000-0000-4000-8000-000000000001'
const bob = '00000000-0000-4000-8000-000000000002'
let db: PGlite
async function asUser<T>(id: string, email: string, fn: () => Promise<T>) {
  await db.exec('begin; set local role aigc_api;')
  try {
    await db.query("select set_config('aigc.user_id',$1,true),set_config('aigc.email',$2,true)", [id, email])
    const result = await fn()
    await db.exec('commit')
    return result
  } catch (error) { await db.exec('rollback'); throw error }
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${alice}'),('${bob}');
    create table public.legacy_data(id integer); insert into public.legacy_data values(1); revoke all on public.legacy_data from public;`)
  await db.exec(readFileSync('supabase/migrations/20260908094310_aigc_foundation.sql','utf8'))
  await db.exec("insert into aigc.invitations(email) values('alice@example.com'),('bob@example.com')")
}, 30000)
afterAll(async () => { await db.close() })
describe('aigc 数据库权限与隔离', () => {
  it('仅受邀邮箱能领取成员资格，重复领取不创建重复成员', async () => {
    const denied = await asUser(alice, 'unknown@example.com', () => db.query<{ allowed: boolean }>('select aigc.claim_invitation() as allowed'))
    expect(denied.rows[0].allowed).toBe(false)
    for (const [id,email] of [[alice,'alice@example.com'],[bob,'bob@example.com'],[alice,'alice@example.com']]) {
      const result = await asUser(id,email, () => db.query<{ allowed: boolean }>('select aigc.claim_invitation() as allowed'))
      expect(result.rows[0].allowed).toBe(true)
    }
    expect((await db.query('select * from aigc.members')).rows).toHaveLength(2)
  })
  it('项目所有权不可伪造，其他用户不能读取、修改项目', async () => {
    await asUser(alice,'alice@example.com', () => db.query("insert into aigc.projects(id,user_id,name,document,drafts) values('p1',$1,'测试','{}','{}')",[alice]))
    await expect(asUser(alice,'alice@example.com', () => db.query("insert into aigc.projects(id,user_id,name,document,drafts) values('forged',$1,'伪造','{}','{}')",[bob]))).rejects.toThrow()
    await asUser(bob,'bob@example.com', async () => {
      expect((await db.query("select * from aigc.projects where id='p1'")).rows).toHaveLength(0)
      expect((await db.query("update aigc.projects set name='覆盖' where id='p1' returning id")).rows).toHaveLength(0)
    })
  })
  it('运行角色不能修改旧应用数据、邀请、成员或 Generation', async () => {
    for (const statement of ['select * from public.legacy_data', 'select * from aigc.invitations', "update aigc.members set status='active'", "insert into aigc.generations(id) values('fake')"]) {
      await expect(asUser(alice,'alice@example.com', () => db.exec(statement))).rejects.toThrow()
    }
    expect((await db.query('select * from public.legacy_data')).rows).toEqual([{ id: 1 }])
  })
  it('跨所有者素材关联被数据库外键拒绝', async () => {
    await expect(asUser(bob,'bob@example.com', () => db.query("insert into aigc.assets(id,project_id,user_id,name,mime_type,size,object_key,temp_key) values('a','p1',$1,'图','image/png',10,'a','b')",[bob]))).rejects.toThrow()
  })
  it('停用成员后无法查询业务数据，也不能重复领取恢复权限', async () => {
    await db.query("update aigc.members set status='disabled' where user_id=$1",[alice])
    await asUser(alice,'alice@example.com', async () => {
      expect((await db.query('select * from aigc.projects')).rows).toHaveLength(0)
      expect((await db.query<{ allowed: boolean }>('select aigc.claim_invitation() as allowed')).rows[0].allowed).toBe(false)
    })
  })
  it('事务结束后身份上下文和角色不残留', async () => {
    expect((await db.query<{ id: string }>("select current_setting('aigc.user_id',true) as id")).rows[0].id).toBe('')
    const { rows } = await db.query<{ role: string }>('select current_user as role')
    expect(rows[0].role).not.toBe('aigc_api')
  })
})
