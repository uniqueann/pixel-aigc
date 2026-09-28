-- 图片生成任务与邮件任务隔离：不依赖 aigc.projects，按用户 + 环境 + request_id 幂等。
create table aigc.image_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  request_id uuid not null,
  request_fingerprint text not null,
  capability text not null check (capability in ('image_edit','text_to_image','variation','inpaint','outpaint')),
  model_profile_id text not null,
  provider text not null,
  params jsonb not null,
  provider_params jsonb not null,
  warnings text[] not null default '{}',
  requested_count int not null check (requested_count between 1 and 4),
  status text not null check (status in ('queued','processing','succeeded','failed','cancelled','expired')),
  error_code text,
  error_message text,
  credits_reserved int not null default 0,
  credits_charged int not null default 0,
  billing_state text not null default 'none' check (billing_state in ('none','reserved','settled','released')),
  lease_until timestamptz,
  next_poll_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default (now() + interval '30 days'),
  unique (user_id, scope, request_id)
);

create table aigc.image_job_items (
  job_id uuid not null references aigc.image_jobs(id) on delete cascade,
  ordinal int not null check (ordinal between 0 and 3),
  user_id uuid not null references aigc.members(user_id),
  scope text not null,
  provider_task_id text,
  status text not null check (status in ('pending','submitted','processing','succeeded','failed','expired')),
  attempts int not null default 0,
  progress int,
  result_object_key text,
  result_mime_type text,
  result_width int,
  result_height int,
  error_code text,
  error_message text,
  updated_at timestamptz not null default now(),
  primary key (job_id, ordinal)
);

create index image_jobs_owner_history on aigc.image_jobs(user_id, scope, created_at desc);
create index image_jobs_expiry on aigc.image_jobs(expires_at);
create index image_jobs_poll on aigc.image_jobs(status, next_poll_at);
create index image_job_items_owner on aigc.image_job_items(user_id, scope);

alter table aigc.image_jobs enable row level security;
alter table aigc.image_job_items enable row level security;
do $$
declare name text;
begin
  foreach name in array array['image_jobs','image_job_items'] loop
    execute format(
      'create policy owner_access on aigc.%I to aigc_api using ('
      || 'user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid '
      || 'and scope=current_setting(''aigc.scope'',true) '
      || 'and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active'')'
      || ') with check ('
      || 'user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid '
      || 'and scope=current_setting(''aigc.scope'',true) '
      || 'and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active'')'
      || ')',
      name
    );
  end loop;
end $$;
grant select,insert,update,delete on aigc.image_jobs, aigc.image_job_items to aigc_api;

create function aigc.image_processing_count(p_scope text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from aigc.image_jobs
  where scope=p_scope
    and status in ('queued','processing')
    and deadline_at>now()
    and expires_at>now()
$$;
revoke all on function aigc.image_processing_count(text) from public,anon,authenticated;
grant execute on function aigc.image_processing_count(text) to aigc_api;

create function aigc.expire_overdue_image_jobs() returns bigint
language plpgsql security definer set search_path = '' as $$
declare expired_count bigint;
begin
  update aigc.image_job_items i
    set status='expired', updated_at=now()
  from aigc.image_jobs j
  where i.job_id=j.id
    and j.status in ('queued','processing')
    and j.deadline_at<=now()
    and i.status in ('pending','submitted','processing');

  update aigc.image_jobs j
    set status = case
        when exists(
          select 1 from aigc.image_job_items i
          where i.job_id=j.id and i.status='succeeded'
        ) then 'succeeded'
        else 'expired'
      end,
      warnings = case
        when exists(select 1 from aigc.image_job_items i where i.job_id=j.id and i.status='succeeded')
         and exists(select 1 from aigc.image_job_items i where i.job_id=j.id and i.status<>'succeeded')
        then (select array(select distinct unnest(coalesce(j.warnings,'{}') || array['PARTIAL'])))
        else j.warnings
      end,
      error_code = case
        when exists(select 1 from aigc.image_job_items i where i.job_id=j.id and i.status='succeeded') then j.error_code
        else coalesce(j.error_code, 'TASK_TIMEOUT')
      end,
      error_message = case
        when exists(select 1 from aigc.image_job_items i where i.job_id=j.id and i.status='succeeded') then j.error_message
        else coalesce(j.error_message, '任务处理超时，请重试')
      end,
      billing_state = case
        when billing_state='reserved' then 'released'
        else billing_state
      end,
      completed_at = coalesce(completed_at, now()),
      updated_at = now()
  where status in ('queued','processing') and deadline_at<=now();
  get diagnostics expired_count = row_count;
  return expired_count;
end $$;
revoke all on function aigc.expire_overdue_image_jobs() from public,anon,authenticated;
grant execute on function aigc.expire_overdue_image_jobs() to aigc_api;

create function aigc.purge_expired_image_jobs() returns bigint
language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from aigc.image_jobs where expires_at<=now();
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function aigc.purge_expired_image_jobs() from public,anon,authenticated;
grant execute on function aigc.purge_expired_image_jobs() to aigc_api;
