-- 仅增加执行凭据；任务终态与计费继续使用原表和原账本。
alter table aigc.image_jobs add column lease_token uuid;
alter table aigc.image_jobs add column lease_owner text check (lease_owner in ('submit','poll','maintenance'));
alter table aigc.image_job_items add column submission_state text
  check (submission_state in ('not_sent','sending','accepted','unknown'));
alter table aigc.image_job_items add column submission_attempt_id uuid;

create table aigc.image_job_attempts (
  id uuid primary key,
  job_id uuid not null references aigc.image_jobs(id) on delete cascade,
  user_id uuid not null references aigc.members(user_id),
  scope text not null check (scope in ('local','preview','production')),
  kind text not null check (kind in ('submit','transfer')),
  ordinals integer[] not null check (cardinality(ordinals) between 1 and 4 and ordinals <@ array[0,1,2,3]),
  provider_task_id text,
  outcome text check (outcome in ('accepted','not_sent','rejected','unknown')),
  retryable boolean not null default false,
  error_code text,
  error_message text,
  object_key text,
  mime_type text,
  width integer,
  height integer,
  checksum text,
  created_at timestamptz not null default clock_timestamp(),
  cleaned_at timestamptz,
  cleanup_token uuid,
  cleanup_until timestamptz,
  check ((kind='submit' and object_key is null) or
    (kind='transfer' and object_key is not null and mime_type is not null and mime_type like 'image/%'
      and width is not null and width>0 and height is not null and height>0
      and checksum is not null and checksum ~ '^[a-f0-9]{64}$'))
);
alter table aigc.image_job_attempts enable row level security;
create policy image_job_attempts_owner on aigc.image_job_attempts to aigc_api
  using (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true))
  with check (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.image_jobs j where j.id=job_id and j.user_id=image_job_attempts.user_id and j.scope=image_job_attempts.scope));
grant select,insert,update on aigc.image_job_attempts to aigc_api;
revoke all on aigc.image_job_attempts from anon,authenticated;
create index image_job_attempts_job on aigc.image_job_attempts(job_id,created_at);
create index image_job_attempts_rpm on aigc.image_job_attempts(scope,created_at) where kind='submit';
create index image_job_attempts_cleanup on aigc.image_job_attempts(scope,created_at)
  where kind='transfer' and cleaned_at is null;
create index image_jobs_maintenance_due on aigc.image_jobs(scope,next_poll_at,deadline_at)
  where capability<>'text_to_video';
create index image_jobs_scope_overdue on aigc.image_jobs(scope,deadline_at)
  where status in ('queued','processing') and capability<>'text_to_video';
create index sync_credit_jobs_scope_overdue on aigc.sync_credit_jobs(scope,deadline_at) where state='reserved';

-- 先锁原任务，再持久化发送意图。平台节流跨用户、跨入口共享。
create function aigc.start_image_submission(p_job uuid,p_token uuid,p_ordinals integer[],p_attempt uuid)
returns setof aigc.image_job_attempts
language plpgsql security definer set search_path='' as $$
declare j aigc.image_jobs%rowtype; s text:=current_setting('aigc.scope',true);
  caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid; count_ready integer;
begin
  select * into j from aigc.image_jobs where id=p_job and user_id=caller and scope=s
    and capability<>'text_to_video' and lease_token=p_token and lease_until>clock_timestamp() for update;
  if not found or j.deadline_at<=clock_timestamp() or j.billing_state<>'reserved' then return; end if;
  if cardinality(p_ordinals) not between 1 and 4 then raise exception '提交序号无效'; end if;
  select count(*) into count_ready from aigc.image_job_items where job_id=p_job and ordinal=any(p_ordinals)
    and submission_state='not_sent' and status='pending' and provider_task_id is null and result_object_key is null;
  if count_ready<>cardinality(p_ordinals) then return; end if;
  perform pg_advisory_xact_lock(91517007,hashtext(s));
  if j.lease_until<=clock_timestamp() or j.deadline_at<=clock_timestamp() then return; end if;
  -- 4 次/分钟是本平台的保守预算，不表示供应商承诺的额度；拒绝也消耗一次预算。
  if j.model_profile_id='bailian:qwen-image-3.0-pro' and
    (select count(*) from aigc.image_job_attempts a join aigc.image_jobs q on q.id=a.job_id
      where a.scope=s and a.kind='submit' and a.created_at>clock_timestamp()-interval '1 minute'
        and q.model_profile_id=j.model_profile_id)>=4 then
    update aigc.image_jobs set next_poll_at=clock_timestamp()+interval '15 seconds' where id=p_job;
    return;
  end if;
  insert into aigc.image_job_attempts(id,job_id,user_id,scope,kind,ordinals)
    values(p_attempt,p_job,caller,s,'submit',p_ordinals);
  update aigc.image_job_items set submission_state='sending',submission_attempt_id=p_attempt,
    attempts=attempts+1,updated_at=now() where job_id=p_job and ordinal=any(p_ordinals);
  return query select * from aigc.image_job_attempts where id=p_attempt;
end $$;
revoke all on function aigc.start_image_submission(uuid,uuid,integer[],uuid) from public,anon,authenticated;
grant execute on function aigc.start_image_submission(uuid,uuid,integer[],uuid) to aigc_api;

-- 每个空闲槽即时领取一项，禁止预先领取整批后排队等待。
create function aigc.claim_due_image_job(p_scope text)
returns table(id uuid,user_id uuid,scope text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare picked uuid;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is distinct from current_setting('aigc.scope',true)
    or p_scope not in ('local','preview','production') then raise exception '图片维护范围无效'; end if;
  perform pg_advisory_xact_lock(91517008,hashtext(p_scope));
  if (select count(*) from aigc.image_jobs j where j.scope=p_scope and j.capability<>'text_to_video'
    and j.lease_owner='maintenance' and j.lease_until>clock_timestamp())>=4 then return; end if;
  select j.id into picked from aigc.image_jobs j where j.scope=p_scope and j.capability<>'text_to_video'
    and j.expires_at>now() and j.next_poll_at<=now() and (j.lease_until is null or j.lease_until<=clock_timestamp())
    and (j.status in ('queued','processing') or (j.deadline_at>now()-interval '24 hours' and exists(
      select 1 from aigc.image_job_items i where i.job_id=j.id and i.result_object_key is null
        and i.status in ('submitted','processing','expired')
        and (i.provider_task_id is not null or i.submission_attempt_id is not null))))
    order by j.next_poll_at,j.created_at,j.id for update skip locked limit 1;
  if picked is null then return; end if;
  return query update aigc.image_jobs j set lease_token=gen_random_uuid(),lease_owner='maintenance',
    lease_until=clock_timestamp()+interval '120 seconds',updated_at=now() where j.id=picked
    returning j.id,j.user_id,j.scope,j.lease_token;
end $$;
revoke all on function aigc.claim_due_image_job(text) from public,anon,authenticated;
grant execute on function aigc.claim_due_image_job(text) to aigc_api;

-- 先登记清理占用，发布结果时也锁同一尝试行；不会删除已经被任务引用的对象。
create function aigc.claim_image_orphans(p_scope text)
returns table(id uuid,object_key text,cleanup_token uuid)
language plpgsql security definer set search_path='' as $$
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is distinct from current_setting('aigc.scope',true)
    or p_scope not in ('local','preview','production') then raise exception '图片清理范围无效'; end if;
  return query with candidates as (
    select a.id from aigc.image_job_attempts a join aigc.image_jobs j on j.id=a.job_id
      where a.scope=p_scope and a.kind='transfer' and a.created_at<now()-interval '24 hours'
        and a.cleaned_at is null and (a.cleanup_until is null or a.cleanup_until<=clock_timestamp())
        and (j.lease_until is null or j.lease_until<=clock_timestamp())
        and not exists(select 1 from aigc.image_job_items i where i.result_object_key=a.object_key)
        and not exists(select 1 from aigc.assets r where r.object_key=a.object_key or r.temp_key=a.object_key)
        and not exists(select 1 from aigc.sync_credit_jobs q where q.result->>'objectKey'=a.object_key)
        and not exists(select 1 from aigc.image_jobs q where q.params->>'sourceImageKey'=a.object_key or q.params->>'referenceImageKey'=a.object_key)
        and (j.deadline_at<=now()-interval '24 hours' or not exists(select 1 from aigc.image_job_items i
          where i.job_id=j.id and i.result_object_key is null and i.status in ('pending','submitted','processing','expired')))
      order by a.created_at for update of a,j skip locked limit 10
  ) update aigc.image_job_attempts a set cleanup_token=gen_random_uuid(),cleanup_until=clock_timestamp()+interval '120 seconds'
    from candidates c where a.id=c.id returning a.id,a.object_key,a.cleanup_token;
end $$;
create function aigc.finish_image_orphan(p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null then raise exception '仅后台服务可清理'; end if;
  update aigc.image_job_attempts set cleaned_at=now(),cleanup_until=null where id=p_id
    and scope=current_setting('aigc.scope',true) and cleanup_token=p_token;
end $$;
revoke all on function aigc.claim_image_orphans(text),aigc.finish_image_orphan(uuid,uuid) from public,anon,authenticated;
grant execute on function aigc.claim_image_orphans(text),aigc.finish_image_orphan(uuid,uuid) to aigc_api;

-- 到期收口与写回锁同一任务行，只处理当前环境，单轮有上限。
-- 共享业务库需要兼容尚未更新的生产每日清理：其旧后台调用没有 scope。
-- 仅无用户身份的旧清理可固定作用于 production；新维护和用户请求必须显式设置环境。
create function aigc.image_cleanup_scope() returns text
language plpgsql set search_path='' as $$
declare s text:=nullif(current_setting('aigc.scope',true),'');
begin
  if s is null and nullif(current_setting('aigc.user_id',true),'') is null then return 'production'; end if;
  if s is null or s not in ('local','preview','production') then raise exception '图片清理范围无效'; end if;
  return s;
end $$;
revoke all on function aigc.image_cleanup_scope() from public,anon,authenticated;
grant execute on function aigc.image_cleanup_scope() to aigc_api;

create or replace function aigc.expire_overdue_image_jobs(p_user uuid default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=aigc.image_cleanup_scope();
  job record;
  success_count integer;
  charge_amount integer;
  refund_amount integer;
  next_balance integer;
  expired_count bigint := 0;
  throttled boolean;
begin
  if (p_user is not null and p_user is distinct from caller)
    or (p_user is null and caller is not null) then
    raise exception '无权清理其他用户的任务';
  end if;
  if s is null or s not in ('local','preview','production') then raise exception '图片清理范围无效'; end if;
  for job in
    select * from aigc.image_jobs
    where scope=s and status in ('queued','processing') and deadline_at<=now()
      and capability<>'text_to_video' and (lease_until is null or lease_until<=clock_timestamp())
      and (p_user is null or user_id=p_user)
    order by deadline_at,id for update skip locked limit 100
  loop
    update aigc.image_job_items set status='expired',updated_at=now()
      where job_id=job.id and status in ('pending','submitted','processing');
    select count(*)::integer into success_count from aigc.image_job_items
      where job_id=job.id and status='succeeded';
    select
      exists (
        select 1 from aigc.image_job_items i
        where i.job_id=job.id and i.provider_task_id is null and i.error_code='RATE_LIMIT'
      )
      and not exists (
        select 1 from aigc.image_job_items i
        where i.job_id=job.id and i.provider_task_id is not null
      )
    into throttled;
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
      error_code=case
        when success_count>0 then job.error_code
        when throttled then 'RATE_LIMIT'
        else 'TASK_TIMEOUT' end,
      error_message=case
        when success_count>0 then job.error_message
        when throttled then '当前排队人数较多，请稍后重试（积分已退回）'
        else '任务处理超时，请重试' end,
      billing_state=case when job.billing_state='reserved'
        then case when success_count>0 then 'settled' else 'released' end
        else job.billing_state end,
      credits_charged=charge_amount,
      completed_at=coalesce(completed_at,now()),updated_at=now(),
      lease_until=null,lease_token=null,lease_owner=null,next_poll_at=now()+interval '5 minutes'
      where id=job.id;
    expired_count := expired_count+1;
  end loop;
  return expired_count;
end $$;

create or replace function aigc.expire_sync_credits() returns integer
language plpgsql security definer set search_path='' as $$
declare caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=aigc.image_cleanup_scope(); j aigc.sync_credit_jobs%rowtype; next_balance integer; count_expired integer:=0;
begin
  if s is null or s not in ('local','preview','production') then raise exception '同步清理范围无效'; end if;
  for j in select * from aigc.sync_credit_jobs where scope=s and state='reserved' and deadline_at<=now()
    and (caller is null or user_id=caller) order by deadline_at,id for update skip locked limit 100 loop
    update aigc.credit_accounts set balance=balance+j.credits_reserved,updated_at=now()
      where user_id=j.user_id and scope=j.scope returning balance into next_balance;
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged,meta)
      values(j.user_id,j.scope,'refund',j.credits_reserved,next_balance,j.id,'job:'||j.id||':refund',0,
        case when j.credits_reserved=0 then jsonb_build_object('tool',j.operation,'free',true,'free_month',j.free_month)
             else jsonb_build_object('tool',j.operation) end);
    update aigc.sync_credit_jobs set state='refunded',error_code='TASK_TIMEOUT',updated_at=now() where id=j.id;
    count_expired:=count_expired+1;
  end loop;
  return count_expired;
end $$;
revoke all on function aigc.expire_sync_credits() from public,anon,authenticated;
grant execute on function aigc.expire_sync_credits() to aigc_api;

-- 新每日清理显式设置环境，旧生产清理通过受限兼容入口；不能删除未收口和孤儿凭据。
create or replace function aigc.purge_expired_image_jobs() returns bigint
language plpgsql security definer set search_path='' as $$
declare s text:=aigc.image_cleanup_scope(); deleted_count bigint;
begin
  if s is null or s not in ('local','preview','production') or nullif(current_setting('aigc.user_id',true),'') is not null then
    raise exception '图片清理范围无效'; end if;
  delete from aigc.image_jobs j where j.id in (select q.id from aigc.image_jobs q
    where q.scope=s and q.expires_at<=now() and q.capability<>'text_to_video' and q.billing_state<>'reserved'
      and (q.lease_until is null or q.lease_until<=clock_timestamp())
      and not exists(select 1 from aigc.image_job_attempts a where a.job_id=q.id and a.kind='transfer'
        and a.cleaned_at is null and not exists(select 1 from aigc.image_job_items i where i.result_object_key=a.object_key))
    order by q.expires_at for update skip locked limit 100);
  get diagnostics deleted_count=row_count;
  return deleted_count;
end $$;

create or replace function aigc.finish_image_credits(p_job uuid,p_charged integer,p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  current_scope text := current_setting('aigc.scope',true);
  job record;
  refund_amount integer;
  next_balance integer;
begin
  if p_kind not in ('settle','refund') then raise exception '积分结算类型无效'; end if;
  select id,user_id,scope,credits_reserved,billing_state,capability,lease_token,lease_until into job from aigc.image_jobs
    where id=p_job and user_id=caller and scope=current_scope for update;
  if not found then raise exception '图片任务不存在'; end if;
  if job.capability<>'text_to_video' and (job.lease_token is not null or exists(
    select 1 from aigc.image_job_items i where i.job_id=job.id and i.submission_state is not null)) and
    (job.lease_token is null or job.lease_token::text is distinct from current_setting('aigc.image_lease_token',true)
      or job.lease_until is null or job.lease_until<=clock_timestamp()) then raise exception '图片任务租约已失效'; end if;
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

-- 主体检测与智能选区保留七天观测记录，配额和权限保持原样。
create or replace function aigc.purge_expired_sync_requests() returns bigint
language plpgsql security definer set search_path = '' as $$
declare s text:=aigc.image_cleanup_scope(); caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid; deleted_count bigint;
begin
  if s is null or s not in ('local','preview','production') then raise exception '同步清理范围无效'; end if;
  delete from aigc.sync_requests
  where scope=s and (caller is null or user_id=caller) and ((route in ('erase', 'repaint', 'outpaint', 'bg-remove', 'subject-detect', 'smart-select') and created_at < now() - interval '7 days')
     or ((route not in ('erase', 'repaint', 'outpaint', 'bg-remove', 'subject-detect', 'smart-select') or route is null) and created_at < now() - interval '2 hours'));
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function aigc.purge_expired_sync_requests() from public,anon,authenticated;
grant execute on function aigc.purge_expired_sync_requests() to aigc_api;

-- 原始行更新也有 fencing；受限后台函数已经在函数内锁行并核对租约。
create function aigc.guard_image_write() returns trigger
language plpgsql set search_path='' as $$
declare j record;
begin
  if current_user<>'aigc_api' then return new; end if;
  if tg_table_name='image_jobs' then
    if old.capability='text_to_video' then return new; end if;
    if old.lease_token is null and new.lease_token is not null then return new; end if;
    -- 可空协议列兼容尚未排空的旧调用；新执行器接管后必须经过 fencing。
    if old.lease_token is null and not exists(select 1 from aigc.image_job_items i
      where i.job_id=old.id and i.submission_state is not null) then return new; end if;
    -- 领取一个已失效租约会换成新令牌；清空令牌是收尾，不属于领取。
    if new.lease_token is not null and new.lease_token is distinct from old.lease_token
      and (old.lease_until is null or old.lease_until<=clock_timestamp()) then return new; end if;
    j:=old;
  else
    select * into j from aigc.image_jobs where id=new.job_id for update;
    if j.capability='text_to_video' then return new; end if;
    if j.lease_token is null and old.submission_state is null and new.submission_state is null then return new; end if;
  end if;
  if j.lease_token is null or j.lease_token::text is distinct from current_setting('aigc.image_lease_token',true)
    or j.lease_until is null or j.lease_until<=clock_timestamp() then raise exception '图片任务租约已失效'; end if;
  return new;
end $$;
create trigger image_jobs_write_fence before update on aigc.image_jobs for each row execute function aigc.guard_image_write();
create trigger image_job_items_write_fence before update on aigc.image_job_items for each row execute function aigc.guard_image_write();
revoke all on function aigc.guard_image_write() from public,anon,authenticated;
