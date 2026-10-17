-- 领取、绑定、收尾各自短事务；计划与稳定请求号不随重启或租约变化。
alter table aigc.suite_batches add column updated_at timestamptz not null default now();
alter table aigc.suite_operations
  add column plan jsonb,
  add column lease_token uuid,
  add column lease_until timestamptz,
  add column next_attempt_at timestamptz not null default now(),
  add column run_id uuid;
-- 兼容已接受的阶段二单槽位批次；已有原任务只能读取，不能重新创建。
update aigc.suite_operations o set plan=jsonb_build_object('item',i.item,'execution',null)
from aigc.suite_batches b join aigc.suite_quotes q on q.id=b.quote_id
cross join lateral jsonb_array_elements(q.snapshot->'items') i(item)
where o.batch_id=b.id and i.item->>'operationId'=o.id::text;
update aigc.suite_operations set snapshot=jsonb_set(snapshot,'{phase}','"bound"')
where snapshot->>'mode'='reuse' and snapshot->>'phase'='dispatching';
alter table aigc.suite_operations alter column plan set not null;
create index suite_operations_due on aigc.suite_operations(scope,next_attempt_at,lease_until)
  where snapshot->>'terminalState' is null and snapshot->>'phase'<>'stopped';
create index suite_operations_user_active on aigc.suite_operations(user_id,scope,batch_id)
  where snapshot->>'terminalState' is null and snapshot->>'phase'<>'stopped';
create unique index suite_operations_retry_once on aigc.suite_operations(user_id,scope,((snapshot->>'retryOfOperationId')::uuid))
  where snapshot ? 'retryOfOperationId';
create index suite_batches_recent on aigc.suite_batches(user_id,scope,created_at desc,id desc);
revoke update on aigc.suite_operations,aigc.suite_batches from aigc_api;
grant update(snapshot,source_job_id,lease_token,lease_until,next_attempt_at,run_id) on aigc.suite_operations to aigc_api;
grant update(state,snapshot,updated_at) on aigc.suite_batches to aigc_api;

-- 唯一跨账号入口只返回当前环境的一项领取身份，不返回配置、对象键或任何密钥。
create function aigc.claim_due_suite_operation(p_scope text,p_run_id uuid)
returns table(id uuid,user_id uuid,project_id uuid,batch_id uuid,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare p record; b record; picked uuid;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is null or p_scope is distinct from current_setting('aigc.scope',true)
    or p_scope not in ('local','preview','production') or p_run_id is null then
    raise exception '套图维护范围无效' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(91517010,hashtext(p_scope));
  if (select count(*) from aigc.suite_operations o where o.scope=p_scope and o.lease_until>clock_timestamp())>=4 then return; end if;
  for p in select x.id from aigc.suite_projects x where x.scope=p_scope
    and exists(select 1 from aigc.members m where m.user_id=x.user_id and m.status='active')
    and exists(select 1 from aigc.suite_batches y join aigc.suite_operations o on o.batch_id=y.id
      where y.project_id=x.id and y.state in ('queued','running','blocked')
        and (o.next_attempt_at<=now() or (y.snapshot->>'dispatchDeadlineAt')::timestamptz<=now()) and (o.lease_until is null or o.lease_until<=clock_timestamp())
        and o.snapshot->>'terminalState' is null and o.snapshot->>'phase'<>'stopped'
        and (o.snapshot->>'phase'<>'blocked' or (y.snapshot->>'dispatchDeadlineAt')::timestamptz<=now()))
    order by x.updated_at,x.id limit 40 for update of x skip locked
  loop
    select y.* into b from aigc.suite_batches y where y.project_id=p.id and y.state in ('queued','running','blocked')
      order by y.created_at,y.id limit 1 for update;
    select o.id into picked from aigc.suite_operations o where o.batch_id=b.id
      and (o.next_attempt_at<=now() or (b.snapshot->>'dispatchDeadlineAt')::timestamptz<=now()) and (o.lease_until is null or o.lease_until<=clock_timestamp())
      and o.snapshot->>'terminalState' is null and o.snapshot->>'phase'<>'stopped'
      and (o.snapshot->>'phase'<>'blocked' or (b.snapshot->>'dispatchDeadlineAt')::timestamptz<=now())
      and (o.source_job_id is not null or o.snapshot->>'phase'='bound'
        or (b.snapshot->>'dispatchDeadlineAt')::timestamptz<=now()
        or not exists(select 1 from aigc.suite_operations busy where busy.user_id=o.user_id and busy.scope=p_scope and busy.id<>o.id
          and busy.snapshot->>'terminalState' is null and busy.snapshot->>'phase'<>'stopped'
          and (busy.source_job_id is not null or busy.lease_until>clock_timestamp())))
      order by o.next_attempt_at,o.id limit 1 for update skip locked;
    if picked is not null then
      return query update aigc.suite_operations o set lease_token=gen_random_uuid(),
        lease_until=clock_timestamp()+interval '120 seconds',run_id=p_run_id,
        snapshot=case when o.snapshot->>'phase'='waiting' then jsonb_set(o.snapshot,'{phase}','"dispatching"') else o.snapshot end
        where o.id=picked returning o.id,o.user_id,o.project_id,o.batch_id,o.lease_token;
      return;
    end if;
  end loop;
end $$;
revoke all on function aigc.claim_due_suite_operation(text,uuid) from public,anon,authenticated;
grant execute on function aigc.claim_due_suite_operation(text,uuid) to aigc_api;

-- 展示身份扩展到父批次，原任务和账本仍保留原身份。
do $$ declare n text; begin
  for n in select conname from pg_constraint where conrelid='aigc.task_ui_state'::regclass and contype='c'
    and pg_get_constraintdef(oid) like '%source_kind%' loop
    execute format('alter table aigc.task_ui_state drop constraint %I',n);
  end loop;
end $$;
alter table aigc.task_ui_state add constraint task_ui_source_kind_check check(source_kind in ('image_job','sync_credit','email_task','suite_batch'));
alter function aigc.task_center_owned(text,uuid) rename to task_center_owned_before_suite_batch;
create function aigc.task_center_owned(k text,i uuid) returns boolean
language sql stable set search_path='' as $$
  select case when k='suite_batch' then exists(select 1 from aigc.suite_batches b
    where b.id=i and b.user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and b.scope=current_setting('aigc.scope',true))
    else aigc.task_center_owned_before_suite_batch(k,i) end
$$;
revoke all on function aigc.task_center_owned(text,uuid) from public,anon,authenticated;
grant execute on function aigc.task_center_owned(text,uuid) to aigc_api;

-- 父批次展示记录按父批次保留，不因没有同编号的原任务被清理。
create or replace function aigc.purge_task_ui_state() returns bigint
language plpgsql security definer set search_path='' as $$
declare s text:=current_setting('aigc.scope',true); n bigint;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null or s is null or s not in ('local','preview','production') then raise exception '任务展示清理范围无效'; end if;
  delete from aigc.task_ui_state u where (u.user_id,u.scope,u.source_kind,u.source_id) in (
    select x.user_id,x.scope,x.source_kind,x.source_id from aigc.task_ui_state x where x.scope=s and
      (x.created_at<now()-interval '30 days' or case x.source_kind
        when 'image_job' then not exists(select 1 from aigc.image_jobs j where j.id=x.source_id and j.user_id=x.user_id and j.scope=x.scope)
        when 'sync_credit' then not exists(select 1 from aigc.sync_credit_jobs j where j.id=x.source_id and j.user_id=x.user_id and j.scope=x.scope)
        when 'email_task' then not exists(select 1 from aigc.email_tasks j where j.id=x.source_id and j.user_id=x.user_id and j.scope=x.scope)
        when 'suite_batch' then not exists(select 1 from aigc.suite_batches j where j.id=x.source_id and j.user_id=x.user_id and j.scope=x.scope)
        else true end)
    order by x.created_at for update skip locked limit 500);
  get diagnostics n=row_count; return n;
end $$;

-- 策略按函数 OID 绑定，重命名旧函数后必须显式更新策略依赖。
alter policy task_ui_owner on aigc.task_ui_state using (
  user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid) and scope=(select current_setting('aigc.scope',true))
  and exists(select 1 from aigc.members where user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid) and status='active')
) with check (
  user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid) and scope=(select current_setting('aigc.scope',true))
  and exists(select 1 from aigc.members where user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid) and status='active')
  and aigc.task_center_owned(source_kind,source_id)
);
