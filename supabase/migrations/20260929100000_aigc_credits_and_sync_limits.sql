-- 积分按用户和运行环境隔离，任务清理后保留完整流水。
create table aigc.credit_accounts (
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  balance integer not null check (balance >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, scope)
);

create table aigc.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  kind text not null check (kind in ('grant','reserve','settle','refund')),
  delta integer not null,
  balance_after integer not null check (balance_after >= 0),
  job_id uuid,
  idempotency_key text not null,
  charged integer,
  meta jsonb not null default '{}',
  operator text,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, scope, idempotency_key)
);
create index credit_ledger_user_time on aigc.credit_ledger(user_id,scope,created_at desc);

create table aigc.sync_requests (
  id uuid primary key,
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  bucket text not null check (bucket in ('generation','detection')),
  lease_until timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index sync_requests_quota on aigc.sync_requests(user_id,scope,bucket,created_at desc);
create index sync_requests_active on aigc.sync_requests(user_id,scope,bucket,lease_until) where completed_at is null;

alter table aigc.credit_accounts enable row level security;
alter table aigc.credit_ledger enable row level security;
alter table aigc.sync_requests enable row level security;
do $$
declare name text;
begin
  foreach name in array array['credit_accounts','credit_ledger','sync_requests'] loop
    execute format(
      'create policy owner_access on aigc.%I to aigc_api using ('
      || 'user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid '
      || 'and scope=current_setting(''aigc.scope'',true) '
      || 'and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active'')'
      || ') with check ('
      || 'user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid '
      || 'and scope=current_setting(''aigc.scope'',true) '
      || 'and exists(select 1 from aigc.members m where m.user_id=nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active'')'
      || ')', name
    );
  end loop;
end $$;
grant select on aigc.credit_accounts,aigc.credit_ledger to aigc_api;
grant select,insert,update,delete on aigc.sync_requests to aigc_api;

create function aigc.ensure_credit_account(p_user uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  current_scope text := current_setting('aigc.scope',true);
  next_balance integer;
begin
  if caller is null or caller is distinct from p_user or current_scope not in ('local','preview','production')
    or not exists(select 1 from aigc.members where user_id=caller and status='active') then
    raise exception '积分账户不可用';
  end if;
  insert into aigc.credit_accounts(user_id,scope,balance)
    values(p_user,current_scope,100) on conflict do nothing returning balance into next_balance;
  if found then
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,reason)
      values(p_user,current_scope,'grant',100,100,'initial','首次赠送');
  end if;
  select balance into next_balance from aigc.credit_accounts
    where user_id=p_user and scope=current_scope;
  return next_balance;
end $$;
revoke all on function aigc.ensure_credit_account(uuid) from public,anon,authenticated;
grant execute on function aigc.ensure_credit_account(uuid) to aigc_api;

create function aigc.reserve_image_credits(p_user uuid,p_job uuid,p_amount integer,p_meta jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  current_scope text := current_setting('aigc.scope',true);
  next_balance integer;
  prior_delta integer;
begin
  if p_amount is null or p_amount<=0 then raise exception '积分单价未配置'; end if;
  perform aigc.ensure_credit_account(p_user);
  select delta into prior_delta from aigc.credit_ledger
    where user_id=p_user and scope=current_scope and idempotency_key='job:' || p_job::text || ':reserve';
  if found then
    if prior_delta<>-p_amount then raise exception '任务预扣金额冲突'; end if;
    return true;
  end if;
  update aigc.credit_accounts set balance=balance-p_amount,updated_at=now()
    where user_id=p_user and scope=current_scope and balance>=p_amount
    returning balance into next_balance;
  if not found then return false; end if;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,meta)
    values(p_user,current_scope,'reserve',-p_amount,next_balance,p_job,'job:' || p_job::text || ':reserve',coalesce(p_meta,'{}'));
  return true;
end $$;
revoke all on function aigc.reserve_image_credits(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function aigc.reserve_image_credits(uuid,uuid,integer,jsonb) to aigc_api;

create function aigc.finish_image_credits(p_job uuid,p_charged integer,p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  current_scope text := current_setting('aigc.scope',true);
  job record;
  refund_amount integer;
  next_balance integer;
begin
  if p_kind not in ('settle','refund') then raise exception '积分结算类型无效'; end if;
  select id,user_id,scope,credits_reserved,billing_state into job from aigc.image_jobs
    where id=p_job and user_id=caller and scope=current_scope for update;
  if not found then raise exception '图片任务不存在'; end if;
  if job.billing_state<>'reserved' then return; end if;
  if p_charged is null or p_charged<0 or p_charged>job.credits_reserved
    or (p_kind='refund' and p_charged<>0) then raise exception '积分结算金额无效'; end if;
  refund_amount := job.credits_reserved-p_charged;
  update aigc.credit_accounts set balance=balance+refund_amount,updated_at=now()
    where user_id=caller and scope=current_scope returning balance into next_balance;
  if not found then raise exception '积分账户不存在'; end if;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged)
    values(caller,current_scope,p_kind,refund_amount,next_balance,p_job,
      'job:' || p_job::text || ':' || p_kind,p_charged);
  update aigc.image_jobs set billing_state=case when p_kind='settle' then 'settled' else 'released' end,
    credits_charged=p_charged,updated_at=now() where id=p_job;
end $$;
revoke all on function aigc.finish_image_credits(uuid,integer,text) from public,anon,authenticated;
grant execute on function aigc.finish_image_credits(uuid,integer,text) to aigc_api;

-- 上线前创建的零预扣任务维持免费，不能在新账本中追溯扣费。
update aigc.image_jobs set billing_state='none'
  where billing_state='reserved' and credits_reserved=0;

-- 用户轮询与定时任务共用同一个超时收口过程。
drop function aigc.expire_overdue_image_jobs();
create or replace function aigc.expire_overdue_image_jobs(p_user uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  job record;
  success_count integer;
  charge_amount integer;
  refund_amount integer;
  next_balance integer;
  expired_count bigint := 0;
begin
  if (p_user is not null and p_user is distinct from caller)
    or (p_user is null and caller is not null) then
    raise exception '无权清理其他用户的任务';
  end if;
  for job in
    select * from aigc.image_jobs
    where status in ('queued','processing') and deadline_at<=now()
      and (p_user is null or user_id=p_user)
    for update skip locked
  loop
    update aigc.image_job_items set status='expired',updated_at=now()
      where job_id=job.id and status in ('pending','submitted','processing');
    select count(*)::integer into success_count from aigc.image_job_items
      where job_id=job.id and status='succeeded';
    charge_amount := 0;
    if job.billing_state='reserved' and job.credits_reserved>0 then
      charge_amount := success_count * (job.credits_reserved / job.requested_count);
      refund_amount := job.credits_reserved - charge_amount;
      if refund_amount>0 then
        update aigc.credit_accounts set balance=balance+refund_amount,updated_at=now()
          where user_id=job.user_id and scope=job.scope returning balance into next_balance;
      else
        select balance into next_balance from aigc.credit_accounts
          where user_id=job.user_id and scope=job.scope;
      end if;
      if next_balance is null then raise exception '图片任务缺少积分账户'; end if;
      insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged)
        values(job.user_id,job.scope,case when success_count>0 then 'settle' else 'refund' end,
          refund_amount,next_balance,job.id,
          'job:' || job.id::text || case when success_count>0 then ':settle' else ':refund' end,
          charge_amount);
    end if;
    update aigc.image_jobs set
      status=case when success_count>0 then 'succeeded' else 'expired' end,
      warnings=case when success_count>0 and success_count<requested_count
        then array(select distinct unnest(coalesce(job.warnings,'{}') || array['PARTIAL']))
        else job.warnings end,
      error_code=case when success_count>0 then job.error_code else 'TASK_TIMEOUT' end,
      error_message=case when success_count>0 then job.error_message else '任务处理超时，请重试' end,
      billing_state=case when job.billing_state='reserved'
        then case when success_count>0 then 'settled' else 'released' end
        else job.billing_state end,
      credits_charged=charge_amount,
      completed_at=coalesce(completed_at,now()),updated_at=now()
      where id=job.id;
    expired_count := expired_count+1;
  end loop;
  return expired_count;
end $$;
revoke all on function aigc.expire_overdue_image_jobs(uuid) from public,anon,authenticated;
grant execute on function aigc.expire_overdue_image_jobs(uuid) to aigc_api;

create or replace function aigc.purge_expired_sync_requests() returns bigint
language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from aigc.sync_requests where created_at<now()-interval '2 hours';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function aigc.purge_expired_sync_requests() from public,anon,authenticated;
grant execute on function aigc.purge_expired_sync_requests() to aigc_api;
