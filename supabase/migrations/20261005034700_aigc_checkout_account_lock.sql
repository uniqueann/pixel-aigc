-- aigc_api 对 aigc.credit_accounts 只有 SELECT。PostgreSQL 的 FOR UPDATE / FOR SHARE
-- 要求至少一列 UPDATE，所以用户角色不能在事务里直接锁这张表。
-- 本函数用定义者权限锁住当前用户、当前环境的积分账户，并返回 payment_blocked。
-- 行锁保持到调用方事务结束，从而和退款收回、预扣共用同一行，避免冻结后仍开出新单。
-- 不授予 balance 或 payment_blocked 的更新权。
create function aigc.lock_credit_account_for_checkout(p_user uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare
  caller uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  current_scope text := current_setting('aigc.scope',true);
  blocked boolean;
begin
  if caller is null or caller is distinct from p_user or current_scope not in ('local','preview','production')
    or not exists(select 1 from aigc.members where user_id=caller and status='active') then
    raise exception '积分账户不可用';
  end if;
  select payment_blocked into blocked from aigc.credit_accounts
    where user_id=p_user and scope=current_scope for update;
  if not found then raise exception '积分账户不存在'; end if;
  return blocked;
end $$;
revoke all on function aigc.lock_credit_account_for_checkout(uuid) from public,anon,authenticated,aigc_billing_worker;
grant execute on function aigc.lock_credit_account_for_checkout(uuid) to aigc_api;
