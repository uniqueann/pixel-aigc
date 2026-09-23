-- 用户自带模型密钥与邮件任务仅写入 aigc 命名空间。
create table aigc.model_credentials (
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  provider text not null check (provider='deepseek'),
  ciphertext text not null,
  iv text not null,
  key_version integer not null default 1,
  key_tail text not null,
  verification_status text not null check (verification_status in ('valid','invalid')),
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(user_id,scope,provider)
);
create table aigc.model_preferences (
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  capability text not null check (capability='email_assist'),
  model_profile_id text not null check (model_profile_id in ('deepseek:deepseek-flash','deepseek:deepseek-v4-pro')),
  updated_at timestamptz not null default now(),
  primary key(user_id,scope,capability)
);
create table aigc.email_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  request_id uuid not null,
  request_fingerprint text not null,
  params jsonb not null,
  model_profile_id text not null,
  status text not null check (status in ('processing','succeeded','failed')),
  result_text text,
  edited_text text,
  error_code text,
  error_message text,
  token_usage jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  unique(user_id,scope,request_id)
);
create index email_tasks_owner_history on aigc.email_tasks(user_id,scope,created_at desc);
create index email_tasks_expiry on aigc.email_tasks(expires_at);

alter table aigc.model_credentials enable row level security;
alter table aigc.model_preferences enable row level security;
alter table aigc.email_tasks enable row level security;
do $$
declare name text;
begin
  foreach name in array array['model_credentials','model_preferences','email_tasks'] loop
    execute format('create policy owner_access on aigc.%I to aigc_api using (user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and scope=current_setting(''aigc.scope'',true) and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active'')) with check (user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and scope=current_setting(''aigc.scope'',true) and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active''))',name);
  end loop;
end $$;
grant select,insert,update,delete on aigc.model_credentials,aigc.model_preferences,aigc.email_tasks to aigc_api;

-- 全站运行量仅返回数字；应用角色不能借此读取别人的邮件正文。
create function aigc.email_processing_count(p_scope text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from aigc.email_tasks
  where scope=p_scope and status='processing' and updated_at>now()-interval '90 seconds' and expires_at>now()
$$;
revoke all on function aigc.email_processing_count(text) from public,anon,authenticated;
grant execute on function aigc.email_processing_count(text) to aigc_api;

create function aigc.purge_expired_email_tasks() returns bigint
language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from aigc.email_tasks where expires_at<=now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function aigc.purge_expired_email_tasks() from public,anon,authenticated;
grant execute on function aigc.purge_expired_email_tasks() to aigc_api;
