import { beforeAll, afterAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

const alice = '00000000-0000-4000-8000-000000000001'
const bob = '00000000-0000-4000-8000-000000000002'
let db: PGlite
async function asUser<T>(id: string, email: string, fn: () => Promise<T>, scope = 'production') {
  await db.exec('begin; set local role aigc_api;')
  try {
    await db.query("select set_config('aigc.user_id',$1,true),set_config('aigc.email',$2,true)", [id, email])
    await db.query("select set_config('aigc.scope',$1,true)", [scope])
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
  await db.query('insert into aigc.members(user_id) values($1)',[alice])
  await db.query("insert into aigc.projects(id,user_id,name,document,drafts) values('legacy',$1,'旧项目','{}','{}')",[alice])
  await db.exec(readFileSync('supabase/migrations/20260923015953_aigc_accounts.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20260923020155_aigc_project_compat.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20260923102829_aigc_email_byok.sql','utf8'))
}, 30000)
afterAll(async () => { await db.close() })
describe('aigc 数据库权限与隔离', () => {
  it('开放初始化幂等，存量项目归入个人空间', async () => {
    for (const [id,email] of [[alice,'alice@example.com'],[bob,'bob@example.com'],[alice,'alice@example.com']]) {
      const result = await asUser(id,email, () => db.query<{ allowed: boolean }>("select aigc.initialize_member('测试用户') as allowed"))
      expect(result.rows[0].allowed).toBe(true)
    }
    expect((await db.query('select * from aigc.members')).rows).toHaveLength(2)
    expect((await db.query('select * from aigc.workspaces')).rows).toHaveLength(2)
    expect((await db.query('select * from aigc.workspace_members')).rows).toHaveLength(2)
    expect((await db.query<{ workspace_id: string }>('select workspace_id from aigc.projects where id=\'legacy\'')).rows[0].workspace_id).toBeTruthy()
    await asUser(alice,'alice@example.com', () => db.query("insert into aigc.projects(id,user_id,name,document,drafts) values('old-client',$1,'兼容项目','{}','{}')",[alice]))
    expect((await db.query<{ workspace_id: string }>("select workspace_id from aigc.projects where id='old-client'")).rows[0].workspace_id).toBeTruthy()
    await expect(asUser(alice,'alice@example.com', () => db.query('select aigc.claim_invitation()'))).rejects.toThrow()
  })
  it('项目所有权不可伪造，其他用户不能读取、修改项目', async () => {
    const space = (await db.query<{ id: string }>('select id from aigc.workspaces where owner_id=$1',[alice])).rows[0].id
    await asUser(alice,'alice@example.com', () => db.query("insert into aigc.projects(id,user_id,workspace_id,name,document,drafts) values('p1',$1,$2,'测试','{}','{}')",[alice,space]))
    await expect(asUser(alice,'alice@example.com', () => db.query("insert into aigc.projects(id,user_id,workspace_id,name,document,drafts) values('forged',$1,$2,'伪造','{}','{}')",[bob,space]))).rejects.toThrow()
    await asUser(bob,'bob@example.com', async () => {
      expect((await db.query("select * from aigc.projects where id='p1'")).rows).toHaveLength(0)
      expect((await db.query("update aigc.projects set name='覆盖' where id='p1' returning id")).rows).toHaveLength(0)
    })
  })
  it('资料只能修改本人，不能改成员状态或他人的空间', async () => {
    const aliceSpace = (await db.query<{ id: string }>('select id from aigc.workspaces where owner_id=$1',[alice])).rows[0].id
    await asUser(alice,'alice@example.com', async () => {
      const own = await db.query("update aigc.members set display_name='新昵称' where user_id=$1 returning display_name",[alice])
      expect(own.rows).toHaveLength(1)
      expect((await db.query("update aigc.members set display_name='冒名' where user_id=$1 returning user_id",[bob])).rows).toHaveLength(0)
    })
    await expect(asUser(alice,'alice@example.com', () => db.query("update aigc.members set status='disabled' where user_id=$1",[alice]))).rejects.toThrow()
    await asUser(bob,'bob@example.com', async () => {
      expect((await db.query('select * from aigc.workspaces where id=$1',[aliceSpace])).rows).toHaveLength(0)
      expect((await db.query("update aigc.workspaces set name='冒名' where id=$1 returning id",[aliceSpace])).rows).toHaveLength(0)
    })
  })
  it('数据库拒绝移除个人空间的所有者管理员', async () => {
    const space = (await db.query<{ id: string }>('select id from aigc.workspaces where owner_id=$1',[bob])).rows[0].id
    await expect(db.query('delete from aigc.workspace_members where workspace_id=$1',[space])).rejects.toThrow()
  })
  it('运行角色不能修改旧应用数据、邀请、成员状态或 Generation', async () => {
    for (const statement of ['select * from public.legacy_data', 'select * from aigc.invitations', "update aigc.members set status='active'", "insert into aigc.generations(id) values('fake')"]) {
      await expect(asUser(alice,'alice@example.com', () => db.exec(statement))).rejects.toThrow()
    }
    expect((await db.query('select * from public.legacy_data')).rows).toEqual([{ id: 1 }])
  })
  it('模型密钥和邮件任务只对本人及同一环境可见', async () => {
    const taskId = '00000000-0000-4000-8000-000000000101'
    await asUser(alice,'alice@example.com', async () => {
      await db.query("insert into aigc.model_credentials(user_id,scope,provider,ciphertext,iv,key_tail,verification_status) values($1,'production','deepseek','密文','随机值','1234','valid')",[alice])
      await db.query("insert into aigc.email_tasks(id,user_id,scope,request_id,request_fingerprint,params,model_profile_id,status) values($1,$2,'production',$3,'hash','{}','deepseek:deepseek-flash','processing')",[taskId,alice,'00000000-0000-4000-8000-000000000102'])
      expect((await db.query('select * from aigc.model_credentials')).rows).toHaveLength(1)
      expect((await db.query('select * from aigc.email_tasks')).rows).toHaveLength(1)
    })
    await asUser(bob,'bob@example.com', async () => {
      expect((await db.query('select * from aigc.model_credentials')).rows).toHaveLength(0)
      expect((await db.query('select * from aigc.email_tasks')).rows).toHaveLength(0)
      expect((await db.query('update aigc.email_tasks set status=\'failed\' where id=$1 returning id',[taskId])).rows).toHaveLength(0)
    })
    await asUser(alice,'alice@example.com', async () => {
      expect((await db.query('select * from aigc.model_credentials')).rows).toHaveLength(0)
      expect((await db.query('select * from aigc.email_tasks')).rows).toHaveLength(0)
    }, 'preview')
    const count = await asUser(alice,'alice@example.com', () => db.query<{ used: number }>("select aigc.email_processing_count('production') as used"))
    expect(Number(count.rows[0].used)).toBe(1)
  })
  it('跨所有者素材关联被数据库外键拒绝', async () => {
    await expect(asUser(bob,'bob@example.com', () => db.query("insert into aigc.assets(id,project_id,user_id,name,mime_type,size,object_key,temp_key) values('a','p1',$1,'图','image/png',10,'a','b')",[bob]))).rejects.toThrow()
  })
  it('停用成员后无法查询业务数据，也不能重复初始化恢复权限', async () => {
    await db.query("update aigc.members set status='disabled' where user_id=$1",[alice])
    await asUser(alice,'alice@example.com', async () => {
      expect((await db.query('select * from aigc.projects')).rows).toHaveLength(0)
      expect((await db.query<{ allowed: boolean }>('select aigc.initialize_member(null) as allowed')).rows[0].allowed).toBe(false)
    })
  })
  it('事务结束后身份上下文和角色不残留', async () => {
    expect((await db.query<{ id: string }>("select current_setting('aigc.user_id',true) as id")).rows[0].id).toBe('')
    const { rows } = await db.query<{ role: string }>('select current_user as role')
    expect(rows[0].role).not.toBe('aigc_api')
  })
})
