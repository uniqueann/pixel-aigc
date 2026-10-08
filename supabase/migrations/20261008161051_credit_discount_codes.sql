-- 保留原价；报价与最终付款分开保存，历史无优惠订单无需回填。
alter table aigc.credit_orders add column quoted_discount jsonb;
alter table aigc.credit_orders add column paid_discount jsonb;
alter table aigc.sync_requests drop constraint sync_requests_bucket_check;
alter table aigc.sync_requests add constraint sync_requests_bucket_check check(bucket in ('generation','detection','payment_discount'));

create function aigc.valid_credit_discount(p_discount jsonb,p_amount integer,p_paid integer)
returns boolean language plpgsql immutable set search_path='' as $$
declare bps numeric; exact numeric;
begin
  if p_amount is null or p_amount<=0 or p_paid is null or p_paid<=0 or p_paid>p_amount then return false; end if;
  if p_discount is null or p_discount='null'::jsonb then return p_paid=p_amount; end if;
  if jsonb_typeof(p_discount)<>'object' or jsonb_typeof(p_discount->'code') is distinct from 'string'
    or jsonb_typeof(p_discount->'id') is distinct from 'string' or coalesce(p_discount->>'code','')!~'^[A-Z0-9]{1,14}$'
    or length(coalesce(p_discount->>'id','')) not between 1 and 200
    or jsonb_typeof(p_discount->'percentBps') is distinct from 'number'
    or jsonb_typeof(p_discount->'discountAmount') is distinct from 'number'
    or jsonb_typeof(p_discount->'payableAmount') is distinct from 'number' then return false; end if;
  bps:=(p_discount->>'percentBps')::numeric;
  if bps<>trunc(bps) or bps<=0 or bps>=10000
    or (p_discount->>'payableAmount')::numeric<>p_paid
    or (p_discount->>'discountAmount')::numeric<>p_amount-p_paid then return false; end if;
  exact:=p_amount::numeric*(10000-bps)/10000;
  return p_paid=floor(exact) or p_paid=ceil(exact);
end $$;
revoke all on function aigc.valid_credit_discount(jsonb,integer,integer) from public,anon,authenticated;
grant execute on function aigc.valid_credit_discount(jsonb,integer,integer) to aigc_api,aigc_billing_worker;
alter table aigc.credit_orders add constraint credit_orders_quoted_discount_check
  check(quoted_discount is null or aigc.valid_credit_discount(quoted_discount,amount,(quoted_discount->>'payableAmount')::integer));
alter table aigc.credit_orders add constraint credit_orders_paid_discount_check
  check(paid_discount is null or aigc.valid_credit_discount(paid_discount,amount,paid_amount));

-- 只有账务后台能保存已重查的收据；保存实付本身不发积分。
create function aigc.record_credit_order_payment(p_order uuid,p_checkout text,p_payment text,p_product text,
  p_amount integer,p_currency text,p_paid integer,p_discount jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare o aigc.credit_orders%rowtype;
begin
  select * into o from aigc.credit_orders where id=p_order for update;
  if not found or o.scope is distinct from current_setting('aigc.scope',true) then raise exception '充值订单不存在'; end if;
  if o.checkout_id is distinct from p_checkout or o.product_id is distinct from p_product
    or o.checkout_id is null or p_checkout='' or o.amount is distinct from p_amount or o.currency is distinct from p_currency
    or p_payment is null or p_payment='' or not aigc.valid_credit_discount(p_discount,o.amount,p_paid)
    or (o.provider='dodo' and coalesce(o.quoted_discount->>'id','') is distinct from coalesce(p_discount->>'id','')) then
    raise exception '充值支付信息不一致';
  end if;
  if o.paid_amount is not null and (o.paid_amount is distinct from p_paid or o.payment_id is distinct from p_payment
    or o.paid_discount is distinct from nullif(p_discount,'null'::jsonb)) then raise exception '订单支付编号或金额冲突'; end if;
  update aigc.credit_orders set payment_id=p_payment,paid_amount=p_paid,paid_discount=nullif(p_discount,'null'::jsonb),updated_at=now() where id=o.id;
end $$;
revoke all on function aigc.record_credit_order_payment(uuid,text,text,text,integer,text,integer,jsonb) from public,anon,authenticated,aigc_api;
grant execute on function aigc.record_credit_order_payment(uuid,text,text,text,integer,text,integer,jsonb) to aigc_billing_worker;

create function aigc.complete_credit_order_with_discount(p_order uuid,p_checkout text,p_payment text,p_product text,
  p_amount integer,p_currency text,p_paid integer,p_event text,p_type text,p_discount jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare o aigc.credit_orders%rowtype; next_balance integer;
begin
  perform aigc.record_credit_order_payment(p_order,p_checkout,p_payment,p_product,p_amount,p_currency,p_paid,p_discount);
  select * into o from aigc.credit_orders where id=p_order for update;
  if o.status in ('paid','refunded','review') then return false; end if;
  update aigc.credit_orders set status='paid',paid_at=now(),updated_at=now() where id=o.id;
  update aigc.credit_accounts set balance=balance+o.credits,updated_at=now()
    where user_id=o.user_id and scope=o.scope returning balance into next_balance;
  if not found then raise exception '充值订单缺少积分账户'; end if;
  insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,meta,reason)
    values(o.user_id,o.scope,'grant',o.credits,next_balance,'order:'||o.id,
      jsonb_build_object('orderId',o.id,'provider',o.provider,'packId',o.pack_id,'amount',o.amount,'currency',o.currency,
        'paidAmount',o.paid_amount,'discount',o.paid_discount),'积分充值');
  insert into aigc.credit_payment_events(provider,provider_mode,event_id,order_id,event_type)
    values(o.provider,o.provider_mode,p_event,o.id,p_type) on conflict do nothing;
  return true;
end $$;
revoke all on function aigc.complete_credit_order_with_discount(uuid,text,text,text,integer,text,integer,text,text,jsonb) from public,anon,authenticated,aigc_api;
grant execute on function aigc.complete_credit_order_with_discount(uuid,text,text,text,integer,text,integer,text,text,jsonb) to aigc_billing_worker;

-- 旧部署仍使用九参数接口，保持原价到账契约以支持先迁移、后发布。
create or replace function aigc.complete_credit_order(p_order uuid,p_checkout text,p_payment text,p_product text,
  p_amount integer,p_currency text,p_paid integer,p_event text,p_type text)
returns boolean language sql security definer set search_path='' as $$
  select aigc.complete_credit_order_with_discount(p_order,p_checkout,p_payment,p_product,p_amount,p_currency,p_paid,p_event,p_type,null::jsonb);
$$;
revoke all on function aigc.complete_credit_order(uuid,text,text,text,integer,text,integer,text,text) from public,anon,authenticated,aigc_api;
grant execute on function aigc.complete_credit_order(uuid,text,text,text,integer,text,integer,text,text) to aigc_billing_worker;

create function aigc.flag_credit_order_review(p_order uuid)
returns void language plpgsql security definer set search_path='' as $$
declare o aigc.credit_orders%rowtype;
begin
  select * into o from aigc.credit_orders where id=p_order for update;
  if not found or o.scope is distinct from current_setting('aigc.scope',true) then raise exception '充值订单不存在'; end if;
  update aigc.credit_orders set status='review',updated_at=now() where id=o.id;
  update aigc.credit_accounts set payment_blocked=true,updated_at=now() where user_id=o.user_id and scope=o.scope;
end $$;
revoke all on function aigc.flag_credit_order_review(uuid) from public,anon,authenticated,aigc_api;
grant execute on function aigc.flag_credit_order_review(uuid) to aigc_billing_worker;
