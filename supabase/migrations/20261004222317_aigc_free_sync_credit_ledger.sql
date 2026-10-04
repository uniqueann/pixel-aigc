-- 免费抠图（credits_reserved=0）的结算、失败退回和超时补记 delta=0 流水，便于从积分明细对账。
-- 只 create or replace 函数，不更新、不删除已有数据。
-- 应用代码仍调用原来的函数签名；本迁移未执行时调用不会报错，只是免费任务暂时没有 0 分明细。
-- 正式环境必须先执行本迁移，再部署对应代码。

create or replace function aigc.finish_sync_credits(p_job uuid,p_result jsonb,p_error text default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=current_setting('aigc.scope',true); j aigc.sync_credit_jobs%rowtype; next_balance integer; kind text; charged integer;
begin
  select * into j from aigc.sync_credit_jobs where id=p_job and user_id=caller and scope=s for update;
  if not found then raise exception '同步任务不存在'; end if;
  if j.state<>'reserved' then return j.state='settled'; end if;
  kind:=case when p_result is null then 'refund' else 'settle' end;
  charged:=case when p_result is null then 0 else coalesce((p_result->>'chargedCredits')::integer,j.credits_reserved) end;
  if charged<0 or charged>j.credits_reserved then raise exception '同步结算金额无效'; end if;
  if p_result is not null and ((j.operation='outpaint' and charged not in (5,10))
    or(j.operation<>'outpaint' and charged<>j.credits_reserved)) then raise exception '同步结算单价无效'; end if;
  if j.deadline_at<=now() then p_result:=null; p_error:='TASK_TIMEOUT'; kind:='refund'; charged:=0; end if;
  if p_result is not null and (p_result->>'objectKey' is null or p_result->>'mimeType' not in ('image/jpeg','image/png')) then
    raise exception '同步结果描述无效';
  end if;
  update aigc.credit_accounts set balance=balance+j.credits_reserved-charged,updated_at=now()
    where user_id=caller and scope=s returning balance into next_balance;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged,meta)
    values(caller,s,kind,j.credits_reserved-charged,next_balance,j.id,
      'job:'||j.id||':'||kind,charged,
      case when j.credits_reserved=0 then jsonb_build_object('tool',j.operation,'free',true,'free_month',j.free_month)
           else jsonb_build_object('tool',j.operation) end);
  update aigc.sync_credit_jobs set state=case when kind='refund' then 'refunded' else 'settled' end,
    result=p_result,error_code=p_error,updated_at=now() where id=j.id;
  return kind='settle';
end $$;
revoke all on function aigc.finish_sync_credits(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function aigc.finish_sync_credits(uuid,jsonb,text) to aigc_api;

create or replace function aigc.expire_sync_credits() returns integer
language plpgsql security definer set search_path='' as $$
declare caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=current_setting('aigc.scope',true); j aigc.sync_credit_jobs%rowtype; next_balance integer; count_expired integer:=0;
begin
  for j in select * from aigc.sync_credit_jobs where state='reserved' and deadline_at<=now()
    and (caller is null or(user_id=caller and scope=s)) for update skip locked loop
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
