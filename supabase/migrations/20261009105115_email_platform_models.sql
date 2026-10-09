-- 邮件沿用现有账户与流水；历史任务不追溯扣费。
alter table aigc.model_preferences drop constraint model_preferences_model_profile_id_check;
alter table aigc.model_preferences add constraint model_preferences_model_profile_id_check
  check(model_profile_id in ('deepseek:deepseek-flash','deepseek:deepseek-v4-pro','ai-gateway:gemini-3.8-flash'));
alter table aigc.email_tasks
  add column price_version text,
  add column credits_reserved integer not null default 0 check(credits_reserved>=0),
  add column credits_charged integer not null default 0 check(credits_charged>=0 and credits_charged<=credits_reserved),
  add column billing_state text not null default 'legacy_free' check(billing_state in ('legacy_free','reserved','settled','refunded')),
  add column deadline_at timestamptz not null default (now()+interval '90 seconds'),
  add column vendor_usage jsonb;
update aigc.email_tasks set deadline_at=created_at+interval '90 seconds';
create index email_tasks_deadline on aigc.email_tasks(scope,deadline_at) where status='processing';

create function aigc.reserve_email_credits(p_task uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=current_setting('aigc.scope',true); j aigc.email_tasks%rowtype; b integer; blocked boolean; prior record;
begin
  perform aigc.ensure_credit_account(u);
  select balance,payment_blocked into b,blocked from aigc.credit_accounts where user_id=u and scope=s for update;
  if blocked then return jsonb_build_object('blocked',true); end if;
  select * into j from aigc.email_tasks where id=p_task and user_id=u and scope=s for update;
  if not found then raise exception '邮件任务不存在'; end if;
  if j.billing_state<>'reserved' or j.price_version is distinct from 'aigc-email-v1'
    or j.credits_reserved is distinct from (case j.model_profile_id
      when 'deepseek:deepseek-flash' then 1 when 'deepseek:deepseek-v4-pro' then 3 when 'ai-gateway:gemini-3.8-flash' then 3 else null end)
    then raise exception '邮件报价无效'; end if;
  select job_id,meta into prior from aigc.credit_ledger where user_id=u and scope=s and idempotency_key='email:'||j.request_id::text||':reserve';
  if found then
    if prior.job_id<>p_task then return jsonb_build_object('expired',true); end if;
    return jsonb_build_object('reserved',true);
  end if;
  if b<j.credits_reserved then return jsonb_build_object('insufficient',true,'required',j.credits_reserved,'balance',b); end if;
  update aigc.credit_accounts set balance=balance-j.credits_reserved,updated_at=now() where user_id=u and scope=s returning balance into b;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,meta)
    values(u,s,'reserve',-j.credits_reserved,b,p_task,'email:'||j.request_id::text||':reserve',jsonb_build_object(
      'capability','email_assist','modelProfileId',j.model_profile_id,'operation',j.params->>'operation',
      'priceVersion',j.price_version,'fingerprint',j.request_fingerprint));
  return jsonb_build_object('reserved',true);
end $$;
revoke all on function aigc.reserve_email_credits(uuid) from public,anon,authenticated;
grant execute on function aigc.reserve_email_credits(uuid) to aigc_api;

-- 私有收口实现：账户锁在任务锁之前；只有包装函数可调用。
create function aigc.finish_email_for_owner(p_task uuid,p_user uuid,p_scope text,p_result text,p_usage jsonb,p_error text,p_message text,p_vendor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j aigc.email_tasks%rowtype; b integer; k text; meta jsonb;
begin
  perform 1 from aigc.credit_accounts where user_id=p_user and scope=p_scope for update;
  select * into j from aigc.email_tasks where id=p_task and user_id=p_user and scope=p_scope for update;
  if not found then return null; end if;
  if j.status<>'processing' then return to_jsonb(j); end if;
  if j.deadline_at<=now() then p_result:=null; p_error:='TASK_TIMEOUT'; p_message:='任务处理超时，积分已返还'; end if;
  if p_result is not null and btrim(p_result)='' then raise exception '邮件结果不能为空'; end if;
  if j.billing_state='reserved' then
    select l.meta into meta from aigc.credit_ledger l where l.user_id=p_user and l.scope=p_scope and l.idempotency_key='email:'||j.request_id::text||':reserve' and l.job_id=j.id;
    if not found then raise exception '邮件预扣流水不存在'; end if;
    k:=case when p_result is null then 'refund' else 'settle' end;
    if k='refund' then
      update aigc.credit_accounts set balance=balance+j.credits_reserved,updated_at=now() where user_id=p_user and scope=p_scope returning balance into b;
    else select balance into b from aigc.credit_accounts where user_id=p_user and scope=p_scope; end if;
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged,meta,reason)
      values(p_user,p_scope,k,case when k='refund' then j.credits_reserved else 0 end,b,j.id,
        'email:'||j.request_id::text||':'||k,case when k='refund' then 0 else j.credits_reserved end,meta,p_error);
  end if;
  update aigc.email_tasks set status=case when p_result is null then 'failed' else 'succeeded' end,
    result_text=p_result,token_usage=p_usage,vendor_usage=p_vendor,error_code=p_error,error_message=p_message,
    billing_state=case when j.billing_state='legacy_free' then 'legacy_free' when p_result is null then 'refunded' else 'settled' end,
    credits_charged=case when p_result is null then 0 else j.credits_reserved end,updated_at=now()
    where id=j.id returning * into j;
  return to_jsonb(j);
end $$;
revoke all on function aigc.finish_email_for_owner(uuid,uuid,text,text,jsonb,text,text,jsonb) from public,anon,authenticated,aigc_api;

create function aigc.finish_email_task(p_task uuid,p_result text,p_usage jsonb,p_error text,p_message text,p_vendor jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid; s text:=current_setting('aigc.scope',true);
begin
  if u is null or s is null or s not in ('local','preview','production') then raise exception '邮件任务身份无效'; end if;
  return aigc.finish_email_for_owner(p_task,u,s,p_result,p_usage,p_error,p_message,p_vendor);
end $$;
revoke all on function aigc.finish_email_task(uuid,text,jsonb,text,text,jsonb) from public,anon,authenticated;
grant execute on function aigc.finish_email_task(uuid,text,jsonb,text,text,jsonb) to aigc_api;

create function aigc.expire_email_tasks(p_scope text) returns integer
language plpgsql security definer set search_path='' as $$
declare j record; n integer:=0; u uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
begin
  if p_scope is null or p_scope not in ('local','preview','production') or p_scope is distinct from current_setting('aigc.scope',true) then raise exception '维护环境无效'; end if;
  for j in select id,user_id from aigc.email_tasks where scope=p_scope and status='processing' and deadline_at<=now()
    and (u is null or user_id=u) order by user_id,id limit 100 loop
    perform aigc.finish_email_for_owner(j.id,j.user_id,p_scope,null,null,'TASK_TIMEOUT','任务处理超时，积分已返还',null);
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function aigc.expire_email_tasks(text) from public,anon,authenticated;
grant execute on function aigc.expire_email_tasks(text) to aigc_api;

-- 新清理按环境执行；旧的全环境清理入口不再授予应用角色。
revoke all on function aigc.purge_expired_email_tasks() from aigc_api;
create function aigc.purge_expired_email_tasks(p_scope text) returns bigint
language plpgsql security definer set search_path='' as $$
declare n bigint;
begin
  if p_scope is distinct from current_setting('aigc.scope',true) or p_scope is null or p_scope not in ('local','preview','production')
    or nullif(current_setting('aigc.user_id',true),'') is not null then raise exception '清理环境无效'; end if;
  perform aigc.expire_email_tasks(p_scope);
  delete from aigc.email_tasks where scope=p_scope and expires_at<=now() and status<>'processing' and billing_state<>'reserved';
  get diagnostics n=row_count; return n;
end $$;
revoke all on function aigc.purge_expired_email_tasks(text) from public,anon,authenticated;
grant execute on function aigc.purge_expired_email_tasks(text) to aigc_api;
