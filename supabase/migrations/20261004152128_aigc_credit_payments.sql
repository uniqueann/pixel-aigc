-- 首次赠送只影响新钱包，已有余额保持原值。
create or replace function aigc.ensure_credit_account(p_user uuid) returns integer
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
    values(p_user,current_scope,30) on conflict do nothing returning balance into next_balance;
  if found then
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,reason)
      values(p_user,current_scope,'grant',30,30,'initial','首次赠送');
  end if;
  select balance into next_balance from aigc.credit_accounts
    where user_id=p_user and scope=current_scope;
  return next_balance;
end $$;
revoke all on function aigc.ensure_credit_account(uuid) from public,anon,authenticated;
grant execute on function aigc.ensure_credit_account(uuid) to aigc_api;


create or replace function aigc.adjust_credits(
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
    values(p_user,p_scope,30) on conflict do nothing;
  if found then
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,reason)
      values(p_user,p_scope,'grant',30,30,'initial','首次赠送');
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

alter table aigc.credit_accounts add column payment_blocked boolean not null default false;
create or replace function aigc.reserve_image_credits(p_user uuid,p_job uuid,p_amount integer,p_meta jsonb) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  current_scope text := current_setting('aigc.scope',true);
  next_balance integer;
  prior_delta integer;
begin
  if p_amount is null or p_amount<=0 then raise exception '积分单价未配置'; end if;
  perform aigc.ensure_credit_account(p_user);
  perform 1 from aigc.credit_accounts where user_id=p_user and scope=current_scope for update;
  if exists(select 1 from aigc.credit_accounts where user_id=p_user and scope=current_scope and payment_blocked) then raise exception '积分账户需要人工核对'; end if;
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

-- 支付后台使用独立受限角色，用户角色不能给自己到账。
do $$ begin
  if not exists(select 1 from pg_roles where rolname='aigc_billing_worker') then
    create role aigc_billing_worker nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
  if exists(select 1 from pg_roles where rolname='aigc_server') then
    grant aigc_billing_worker to aigc_server;
  end if;
end $$;
grant usage on schema aigc to aigc_billing_worker;

create table aigc.credit_orders (
  id uuid primary key,
  user_id uuid not null references aigc.members(user_id),
  scope text not null check(scope in ('local','preview','production')),
  provider text not null check(provider in ('creem','dodo')),
  provider_mode text not null check(provider_mode in ('test','live')),
  pack_id text not null check(pack_id in ('starter','standard','studio')),
  product_id text not null,
  amount integer not null check(amount>0),
  currency text not null check(currency in ('USD','CNY')),
  credits integer not null check(credits>0),
  status text not null default 'pending' check(status in ('pending','paid','failed','refunded','review')),
  checkout_id text,
  checkout_url text,
  payment_id text,
  paid_amount integer,
  paid_at timestamptz,
  refunded_amount integer not null default 0 check(refunded_amount>=0),
  revoked_credits integer not null default 0 check(revoked_credits>=0),
  refund_held_credits integer not null default 0 check(refund_held_credits>=0),
  refund_requested boolean not null default false,
  refund_reason text,
  refund_requested_at timestamptz,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider,provider_mode,checkout_id),
  unique(provider,provider_mode,payment_id)
);
create index credit_orders_owner on aigc.credit_orders(user_id,scope,created_at desc);
create index credit_orders_pending on aigc.credit_orders(scope,last_checked_at) where status='pending' and checkout_id is not null;
alter table aigc.credit_orders enable row level security;
create policy owner_access on aigc.credit_orders to aigc_api
  using(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members where user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and status='active'))
  with check(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members where user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and status='active'));
create policy worker_access on aigc.credit_orders to aigc_billing_worker using(true);
grant select,insert on aigc.credit_orders to aigc_api;
grant update(checkout_id,checkout_url,refund_requested,refund_reason,refund_requested_at,updated_at) on aigc.credit_orders to aigc_api;
grant select on aigc.credit_orders to aigc_billing_worker;
grant update(last_checked_at) on aigc.credit_orders to aigc_billing_worker;

create table aigc.credit_payment_events (
  provider text not null,
  provider_mode text not null,
  event_id text not null,
  order_id uuid references aigc.credit_orders(id),
  event_type text not null,
  created_at timestamptz not null default now(),
  primary key(provider,provider_mode,event_id)
);
alter table aigc.credit_payment_events enable row level security;

create function aigc.complete_credit_order(p_order uuid,p_checkout text,p_payment text,p_product text,
  p_amount integer,p_currency text,p_paid integer,p_event text,p_type text) returns boolean
language plpgsql security definer set search_path='' as $$
declare o aigc.credit_orders%rowtype; next_balance integer;
begin
  select * into o from aigc.credit_orders where id=p_order for update;
  if not found or o.scope is distinct from current_setting('aigc.scope',true) then raise exception '充值订单不存在'; end if;
  if o.checkout_id is distinct from p_checkout or o.product_id is distinct from p_product
    or o.checkout_id is null or p_checkout='' or o.amount is distinct from p_amount or o.currency is distinct from p_currency or p_paid is distinct from o.amount
    or p_payment is null or p_payment='' then raise exception '充值支付信息不一致'; end if;
  if o.status='paid' then
    if o.payment_id is distinct from p_payment then raise exception '订单支付编号冲突'; end if;
    return false;
  end if;
  if o.status in ('refunded','review') then return false; end if;
  -- 回调与补偿查询共用订单号幂等键，不以事件号重复发放。
  update aigc.credit_orders set status='paid',payment_id=p_payment,paid_amount=p_paid,
    paid_at=now(),updated_at=now() where id=o.id;
  update aigc.credit_accounts set balance=balance+o.credits,updated_at=now()
    where user_id=o.user_id and scope=o.scope returning balance into next_balance;
  if not found then raise exception '充值订单缺少积分账户'; end if;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,meta,reason)
    values(o.user_id,o.scope,'grant',o.credits,next_balance,'order:'||o.id,
      jsonb_build_object('orderId',o.id,'provider',o.provider,'packId',o.pack_id,'amount',o.amount,'currency',o.currency),'积分充值');
  insert into aigc.credit_payment_events(provider,provider_mode,event_id,order_id,event_type)
    values(o.provider,o.provider_mode,p_event,o.id,p_type) on conflict do nothing;
  return true;
end $$;
revoke all on function aigc.complete_credit_order(uuid,text,text,text,integer,text,integer,text,text) from public,anon,authenticated,aigc_api;
grant execute on function aigc.complete_credit_order(uuid,text,text,text,integer,text,integer,text,text) to aigc_billing_worker;

-- 外部退款按累计现金金额比例收回购买积分；赠送积分不能折现。
-- 已消费导致余额不足时冻结收费能力，并留下欠收记录供人工核对。
create function aigc.reverse_credit_order(p_order uuid,p_cash integer,p_currency text,p_event text,p_type text)
returns void language plpgsql security definer set search_path='' as $$
declare o aigc.credit_orders%rowtype; target integer; delta integer; available integer; next_balance integer; held integer;
begin
  select * into o from aigc.credit_orders where id=p_order for update;
  if not found or o.scope is distinct from current_setting('aigc.scope',true) then raise exception '充值订单不存在'; end if;
  if p_currency is distinct from o.currency or p_cash is null or p_cash<0 or p_cash>coalesce(o.paid_amount,o.amount) then
    raise exception '退款信息不一致';
  end if;
  if p_cash<o.refunded_amount then return; end if;
  if exists(select 1 from aigc.credit_payment_events where provider=o.provider and provider_mode=o.provider_mode and event_id=p_event) then return; end if;
  target := least(o.credits,ceil(o.credits::numeric*p_cash/coalesce(o.paid_amount,o.amount))::integer);
  delta := case when o.paid_at is null then 0 else greatest(0,target-o.revoked_credits) end;
  held := least(delta,o.refund_held_credits);
  delta := delta-held;
  select balance into available from aigc.credit_accounts where user_id=o.user_id and scope=o.scope for update;
  if available is null then raise exception '积分账户不存在'; end if;
  next_balance := greatest(0,available-delta);
  update aigc.credit_accounts set balance=next_balance,
    payment_blocked=payment_blocked or delta>available or p_type like 'dispute%',updated_at=now()
    where user_id=o.user_id and scope=o.scope;
  if delta>0 and o.paid_at is not null then
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,meta,reason)
      values(o.user_id,o.scope,'adjust',-least(delta,available),next_balance,'order:'||o.id||':revoke:'||target,
        jsonb_build_object('orderId',o.id,'cashRefunded',p_cash,'currency',p_currency,'uncollectedCredits',greatest(0,delta-available)),
        '现金退款或支付争议收回充值积分');
  end if;
  update aigc.credit_orders set refunded_amount=p_cash,revoked_credits=target,
    refund_held_credits=refund_held_credits-held,
    status=case when delta>available or p_type like 'dispute%' or o.paid_at is null then 'review' when p_cash>=coalesce(paid_amount,amount) then 'refunded' else 'paid' end,
    updated_at=now() where id=o.id;
  insert into aigc.credit_payment_events(provider,provider_mode,event_id,order_id,event_type)
    values(o.provider,o.provider_mode,p_event,o.id,p_type);
end $$;
revoke all on function aigc.reverse_credit_order(uuid,integer,text,text,text) from public,anon,authenticated,aigc_api;
grant execute on function aigc.reverse_credit_order(uuid,integer,text,text,text) to aigc_billing_worker;

create table aigc.credit_refund_reviews (
  idempotency_key text primary key,
  order_id uuid not null references aigc.credit_orders(id),
  cash_total integer not null check(cash_total>0),
  cash_before integer not null,
  held_credits integer not null check(held_credits>0),
  operator text not null,
  reason text not null,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
alter table aigc.credit_refund_reviews enable row level security;

-- 审核后先冻结积分，再由人工在原支付平台退款。此过程不向用户角色开放。
create function aigc.prepare_cash_refund(p_order uuid,p_scope text,p_cash_total integer,p_key text,p_operator text,p_reason text)
returns integer language plpgsql security definer set search_path='' as $$
declare o aigc.credit_orders%rowtype; grant_row aigc.credit_ledger%rowtype; prior aigc.credit_refund_reviews%rowtype;
  consumed integer; unused integer; required integer; available integer;
begin
  if p_operator is null or length(btrim(p_operator))=0 or p_reason is null or length(btrim(p_reason))=0
    or p_key is null or length(p_key)<1 or length(p_key)>128 then raise exception '缺少退款审核记录'; end if;
  select * into prior from aigc.credit_refund_reviews where idempotency_key=p_key;
  if found then
    if prior.order_id is distinct from p_order or prior.cash_total is distinct from p_cash_total then raise exception '退款审核幂等键冲突'; end if;
    if prior.cancelled_at is not null then raise exception '退款审核已取消，请使用新的审核幂等键'; end if;
    return prior.held_credits;
  end if;
  select * into o from aigc.credit_orders where id=p_order and scope=p_scope for update;
  if not found or o.status<>'paid' or not o.refund_requested or p_cash_total is null
    or p_cash_total<=o.refunded_amount or p_cash_total>o.paid_amount then raise exception '退款订单状态或金额无效'; end if;
  select balance into available from aigc.credit_accounts where user_id=o.user_id and scope=o.scope for update;
  select * into grant_row from aigc.credit_ledger where user_id=o.user_id and scope=o.scope and idempotency_key='order:'||o.id;
  if not found then raise exception '订单缺少充值流水'; end if;
  -- 按赠送和旧余额先消耗估算；后续充值不增加旧订单的可退积分。
  select greatest(0,-coalesce(sum(delta),0))::integer into consumed from aigc.credit_ledger
    where user_id=o.user_id and scope=o.scope and created_at>=grant_row.created_at
      and kind in ('reserve','settle','refund','adjust')
      and not(kind='adjust' and meta->>'orderId'=o.id::text and (meta ? 'refundHold' or meta ? 'cashRefunded'));
  unused:=greatest(0,o.credits-greatest(0,consumed-(grant_row.balance_after-o.credits))-o.revoked_credits-o.refund_held_credits);
  required:=ceil(o.credits::numeric*p_cash_total/o.paid_amount)::integer-o.revoked_credits-o.refund_held_credits;
  if required<=0 or required>unused or required>available then raise exception '未使用充值积分不足，不能退款'; end if;
  update aigc.credit_accounts set balance=balance-required,updated_at=now() where user_id=o.user_id and scope=o.scope returning balance into available;
  update aigc.credit_orders set refund_held_credits=refund_held_credits+required,updated_at=now() where id=o.id;
  insert into aigc.credit_refund_reviews(idempotency_key,order_id,cash_total,cash_before,held_credits,operator,reason)
    values(p_key,o.id,p_cash_total,o.refunded_amount,required,p_operator,p_reason);
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,operator,reason,meta)
    values(o.user_id,o.scope,'adjust',-required,available,'refund-review:'||p_key,p_operator,p_reason,
      jsonb_build_object('orderId',o.id,'cashTotal',p_cash_total,'currency',o.currency,'refundHold',required));
  return required;
end $$;
revoke all on function aigc.prepare_cash_refund(uuid,text,integer,text,text,text) from public,anon,authenticated,aigc_api,aigc_billing_worker;

create function aigc.cancel_cash_refund(p_key text,p_scope text,p_operator text,p_reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare r aigc.credit_refund_reviews%rowtype; o aigc.credit_orders%rowtype; next_balance integer;
begin
  if p_operator is null or length(btrim(p_operator))=0 or p_reason is null or length(btrim(p_reason))=0 then raise exception '缺少取消审核记录'; end if;
  select * into r from aigc.credit_refund_reviews where idempotency_key=p_key for update;
  if not found then raise exception '退款审核记录不存在'; end if;
  select * into o from aigc.credit_orders where id=r.order_id and scope=p_scope for update;
  if not found then raise exception '退款环境不一致'; end if;
  if r.cancelled_at is not null then return 0; end if;
  if o.refunded_amount<>r.cash_before or o.status<>'paid' or o.refund_held_credits<r.held_credits then
    raise exception '现金退款已经发生或状态已变化，不能释放冻结积分';
  end if;
  update aigc.credit_accounts set balance=balance+r.held_credits,updated_at=now()
    where user_id=o.user_id and scope=o.scope returning balance into next_balance;
  update aigc.credit_orders set refund_held_credits=refund_held_credits-r.held_credits,updated_at=now() where id=o.id;
  update aigc.credit_refund_reviews set cancelled_at=now() where idempotency_key=p_key;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,operator,reason,meta)
    values(o.user_id,o.scope,'adjust',r.held_credits,next_balance,'refund-review:'||p_key||':cancel',p_operator,p_reason,
      jsonb_build_object('orderId',o.id,'refundHold',-r.held_credits));
  return r.held_credits;
end $$;
revoke all on function aigc.cancel_cash_refund(text,text,text,text) from public,anon,authenticated,aigc_api,aigc_billing_worker;

create table aigc.sync_credit_jobs (
  id uuid primary key,
  user_id uuid not null references aigc.members(user_id),
  scope text not null check(scope in ('local','preview','production')),
  operation text not null check(operation in ('erase','repaint','outpaint','bg-remove')),
  fingerprint text not null,
  price_version text not null,
  credits_reserved integer not null check(credits_reserved>=0),
  free_month text,
  state text not null default 'reserved' check(state in ('reserved','settled','refunded')),
  result jsonb,
  error_code text,
  deadline_at timestamptz not null default now()+interval '3 minutes',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sync_credit_jobs_owner on aigc.sync_credit_jobs(user_id,scope,created_at desc);
create index sync_credit_jobs_free on aigc.sync_credit_jobs(user_id,scope,free_month) where free_month is not null and state<>'refunded';
create index sync_credit_jobs_deadline on aigc.sync_credit_jobs(deadline_at) where state='reserved';
alter table aigc.sync_credit_jobs enable row level security;
create policy owner_access on aigc.sync_credit_jobs to aigc_api
  using(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members where user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and status='active'));
grant select on aigc.sync_credit_jobs to aigc_api;

create function aigc.reserve_sync_credits(p_job uuid,p_operation text,p_hash text,p_version text,p_amount integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=current_setting('aigc.scope',true); j aigc.sync_credit_jobs%rowtype; amount integer:=p_amount;
  month_key text:=to_char(now() at time zone 'Asia/Shanghai','YYYY-MM'); free_used integer;
begin
  perform aigc.ensure_credit_account(caller);
  perform 1 from aigc.credit_accounts where user_id=caller and scope=s for update;
  if exists(select 1 from aigc.credit_accounts where user_id=caller and scope=s and payment_blocked) then raise exception '积分账户需要人工核对'; end if;
  select * into j from aigc.sync_credit_jobs where id=p_job;
  if found then
    if j.user_id is distinct from caller or j.scope is distinct from s or j.fingerprint is distinct from p_hash
      or j.operation is distinct from p_operation then raise exception '同步请求编号冲突'; end if;
    return to_jsonb(j)||jsonb_build_object('reused',true);
  end if;
  if p_version is distinct from 'aigc-sync-v1' or p_hash is null or length(p_hash)<>64
    or not((p_operation in ('erase','repaint') and amount=5) or(p_operation='outpaint' and amount in (5,10))
      or(p_operation='bg-remove' and amount in (0,1))) then raise exception '同步报价无效'; end if;
  if p_operation='bg-remove' then
    select count(*) into free_used from aigc.sync_credit_jobs
      where user_id=caller and scope=s and free_month=month_key and state<>'refunded';
    if free_used<20 then amount:=0; else
      if p_amount=0 then return jsonb_build_object('quoteChanged',true); end if;
      amount:=1; month_key:=null;
    end if;
  else month_key:=null; end if;
  if amount>0 and not aigc.reserve_image_credits(caller,p_job,amount,jsonb_build_object('tool',p_operation)) then
    return jsonb_build_object('insufficient',true,'required',amount,'balance',aigc.ensure_credit_account(caller));
  end if;
  insert into aigc.sync_credit_jobs(id,user_id,scope,operation,fingerprint,price_version,credits_reserved,free_month)
    values(p_job,caller,s,p_operation,p_hash,p_version,amount,month_key) returning * into j;
  return to_jsonb(j)||jsonb_build_object('reused',false);
end $$;
revoke all on function aigc.reserve_sync_credits(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function aigc.reserve_sync_credits(uuid,text,text,text,integer) to aigc_api;

create function aigc.finish_sync_credits(p_job uuid,p_result jsonb,p_error text default null) returns boolean
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
  if j.credits_reserved>0 then
    insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged,meta)
      values(caller,s,kind,j.credits_reserved-charged,next_balance,j.id,
        'job:'||j.id||':'||kind,charged,jsonb_build_object('tool',j.operation));
  end if;
  update aigc.sync_credit_jobs set state=case when kind='refund' then 'refunded' else 'settled' end,
    result=p_result,error_code=p_error,updated_at=now() where id=j.id;
  return kind='settle';
end $$;
revoke all on function aigc.finish_sync_credits(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function aigc.finish_sync_credits(uuid,jsonb,text) to aigc_api;

create function aigc.expire_sync_credits() returns integer
language plpgsql security definer set search_path='' as $$
declare caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=current_setting('aigc.scope',true); j aigc.sync_credit_jobs%rowtype; next_balance integer; count_expired integer:=0;
begin
  for j in select * from aigc.sync_credit_jobs where state='reserved' and deadline_at<=now()
    and (caller is null or(user_id=caller and scope=s)) for update skip locked loop
    update aigc.credit_accounts set balance=balance+j.credits_reserved,updated_at=now()
      where user_id=j.user_id and scope=j.scope returning balance into next_balance;
    if j.credits_reserved>0 then
      insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged,meta)
        values(j.user_id,j.scope,'refund',j.credits_reserved,next_balance,j.id,'job:'||j.id||':refund',0,jsonb_build_object('tool',j.operation));
    end if;
    update aigc.sync_credit_jobs set state='refunded',error_code='TASK_TIMEOUT',updated_at=now() where id=j.id;
    count_expired:=count_expired+1;
  end loop;
  return count_expired;
end $$;
revoke all on function aigc.expire_sync_credits() from public,anon,authenticated;
grant execute on function aigc.expire_sync_credits() to aigc_api;
