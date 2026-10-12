import { readFileSync,readdirSync } from 'node:fs'

/** 仅供空白独立测试库使用；不接收业务库，不删除现有 schema。 */
export async function bootstrapImageTestDatabase(exec: (sql: string) => Promise<unknown>,userIds: string[]) {
  if (userIds.some(id => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error('测试账号编号无效')
  await exec(`do $$ begin
    if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
    if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$; create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ${userIds.map(id => `('${id}')`).join(',')};`)
  for (const file of readdirSync('supabase/migrations').filter(file => file.endsWith('.sql')).sort()) {
    const source = readFileSync(`supabase/migrations/${file}`,'utf8')
    // 同一临时集群的不同空白数据库可复用角色，迁移正文保持原样。
    try { await exec(file === '20260908094310_aigc_foundation.sql'
      ? source.replace('create role aigc_api nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;',
        () => "do $$ begin if not exists(select 1 from pg_roles where rolname='aigc_api') then create role aigc_api nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls; end if; end $$;")
      : source) } catch (cause) { throw new Error(`独立测试库迁移失败：${file}`,{ cause }) }
  }
  await exec(`insert into aigc.members(user_id) values ${userIds.map(id => `('${id}')`).join(',')};`)
}
