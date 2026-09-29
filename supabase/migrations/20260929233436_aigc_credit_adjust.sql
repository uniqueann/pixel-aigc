-- 管理员可安全调余额（含扣到 0），写入 adjust 流水；不改预扣/结算/退款过程。
do $$
declare con name;
begin
  select conname into con
  from pg_constraint
  where conrelid = 'aigc.credit_ledger'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%kind%';
  if con is not null then
    execute format('alter table aigc.credit_ledger drop constraint %I', con);
  end if;
end $$;
alter table aigc.credit_ledger add constraint credit_ledger_kind_check
  check (kind in ('grant','reserve','settle','refund','adjust'));

create function aigc.adjust_credits(
  p_user uuid,
  p_scope text,
  p_mode text,
  p_value integer,
  p_operator text,
  p_reason text,
  p_key text
) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  current_balance integer;
  next_balance integer;
  applied_delta integer;
  prior aigc.credit_ledger%rowtype;
  idempotency text;
begin
  if p_scope not in ('local','preview','production') then raise exception '积分环境无效'; end if;
  if p_mode not in ('set','delta') then raise exception '积分调整方式无效'; end if;
  if p_operator is null or length(btrim(p_operator))=0 or length(p_operator)>80 then raise exception '缺少操作人'; end if;
  if p_reason is null or length(btrim(p_reason))=0 or length(p_reason)>200 then raise exception '缺少调整原因'; end if;
  if p_key is null or length(p_key)=0 or length(p_key)>128 then raise exception '缺少幂等键'; end if;
  if p_mode='set' and (p_value is null or p_value<0 or p_value>1000000) then raise exception '目标余额无效'; end if;
  if p_mode='delta' and (p_value is null or p_value=0 or abs(p_value)>1000000) then raise exception '调整金额无效'; end if;
  if not exists(select 1 from aigc.members where user_id=p_user) then raise exception '成员不存在'; end if;

  idempotency := 'admin:' || p_key;
  insert into aigc.credit_accounts(user_id,scope,balance)
    values(p_user,p_scope,100) on conflict do nothing;
  if found then
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,reason)
      values(p_user,p_scope,'grant',100,100,'initial','首次赠送');
  end if;

  select * into prior from aigc.credit_ledger
    where user_id=p_user and scope=p_scope and idempotency_key=idempotency;
  if found then
    if prior.kind is distinct from 'adjust'
      or prior.meta->>'mode' is distinct from p_mode
      or (prior.meta->>'value')::integer is distinct from p_value then
      raise exception '幂等键已用于不同调整';
    end if;
    select balance into current_balance from aigc.credit_accounts
      where user_id=p_user and scope=p_scope;
    return current_balance;
  end if;

  select balance into current_balance from aigc.credit_accounts
    where user_id=p_user and scope=p_scope for update;
  if current_balance is null then raise exception '积分账户不存在'; end if;

  if p_mode='set' then
    next_balance := p_value;
  else
    next_balance := greatest(0, current_balance + p_value);
  end if;

  applied_delta := next_balance - current_balance;
  update aigc.credit_accounts set balance=next_balance,updated_at=now()
    where user_id=p_user and scope=p_scope;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,meta,operator,reason)
    values(
      p_user,p_scope,'adjust',applied_delta,next_balance,idempotency,
      jsonb_build_object('mode',p_mode,'value',p_value),
      p_operator,p_reason
    );
  return next_balance;
end $$;
revoke all on function aigc.adjust_credits(uuid,text,text,integer,text,text,text) from public,anon,authenticated,aigc_api;
