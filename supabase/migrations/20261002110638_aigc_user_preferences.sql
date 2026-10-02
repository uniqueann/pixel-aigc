-- 个性化配置按账号和环境隔离，仅通过应用服务端访问。
create table aigc.user_preferences (
  user_id uuid not null references aigc.members(user_id) on delete cascade,
  scope text not null check (scope in ('local','preview','production')),
  schema_version integer not null default 1 check (schema_version=1),
  preferences jsonb not null check (jsonb_typeof(preferences)='object'),
  updated_at timestamptz not null default now(),
  primary key(user_id,scope)
);
alter table aigc.user_preferences enable row level security;
create policy owner_access on aigc.user_preferences to aigc_api
  using (
    user_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and m.status='active')
  )
  with check (
    user_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and m.status='active')
  );
revoke all on aigc.user_preferences from public,anon,authenticated;
grant select,insert,update on aigc.user_preferences to aigc_api;
