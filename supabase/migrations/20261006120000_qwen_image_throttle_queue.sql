-- 千问文生图：限流排队到截止时退款文案，以及创建前的供应商/模型并发计数。
-- 计数函数与 image_processing_count 一样是 security definer，避免行级安全只看见当前用户。

create function aigc.image_provider_active_count(p_scope text, p_provider text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from aigc.image_jobs
  where scope=p_scope and provider=p_provider and capability<>'text_to_video'
    and status in ('queued','processing') and deadline_at>now() and expires_at>now()
$$;

create function aigc.image_model_active_count(p_scope text, p_model text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from aigc.image_jobs
  where scope=p_scope and model_profile_id=p_model and capability<>'text_to_video'
    and status in ('queued','processing') and deadline_at>now() and expires_at>now()
$$;

revoke all on function aigc.image_provider_active_count(text, text) from public, anon, authenticated;
revoke all on function aigc.image_model_active_count(text, text) from public, anon, authenticated;
grant execute on function aigc.image_provider_active_count(text, text) to aigc_api;
grant execute on function aigc.image_model_active_count(text, text) to aigc_api;

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
  throttled boolean;
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
      completed_at=coalesce(completed_at,now()),updated_at=now()
      where id=job.id;
    expired_count := expired_count+1;
  end loop;
  return expired_count;
end $$;
