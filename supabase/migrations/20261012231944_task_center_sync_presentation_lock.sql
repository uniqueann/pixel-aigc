-- 同步任务只开放本人当前环境的行锁；展示写入仍由应用角色及原 RLS 完成。
create function aigc.lock_task_center_sync(p_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  runtime text := current_setting('aigc.scope',true);
begin
  if caller is null or runtime is null or runtime not in ('local','preview','production')
    or not exists(select 1 from aigc.members where user_id=caller and status='active') then
    raise exception '任务展示身份无效' using errcode='42501';
  end if;
  perform id from aigc.sync_credit_jobs
    where id=p_id and user_id=caller and scope=runtime for update;
  return found;
end $$;
revoke all on function aigc.lock_task_center_sync(uuid) from public,anon,authenticated;
grant execute on function aigc.lock_task_center_sync(uuid) to aigc_api;
comment on function aigc.lock_task_center_sync(uuid) is '仅锁定本人当前环境的同步原任务；不修改任务或积分，供展示版本核对使用';
