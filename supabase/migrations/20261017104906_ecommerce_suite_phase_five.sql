-- 清理保留请求、版本与账本元数据，只在七天回收期后移除无原任务引用的图片字节。
alter table aigc.suite_projects add column purge_started_at timestamptz, add column purged_at timestamptz;
alter table aigc.suite_assets add column purged_at timestamptz;
create index suite_projects_trash_due on aigc.suite_projects(scope,deleted_at,id) where deleted_at is not null and purged_at is null;
revoke update on aigc.suite_projects,aigc.suite_assets from aigc_api;
grant update(config,revision,updated_at,deleted_at) on aigc.suite_projects to aigc_api;
grant update(object_key,width,height,checksum,status) on aigc.suite_assets to aigc_api;

-- 对象写入前记录意图；登记失败的持久对象也可在项目到期后追踪清理。
create table aigc.suite_object_writes (
  object_key text primary key, user_id uuid not null, scope text not null, project_id uuid not null,
  last_write_at timestamptz not null default now(), next_attempt_at timestamptz not null default now(),
  lease_token uuid, lease_until timestamptz, deleted_at timestamptz,
  foreign key(user_id,scope,project_id) references aigc.suite_projects(user_id,scope,id),
  check(object_key like 'suite-assets/'||scope||'/'||user_id::text||'/'||project_id::text||'/%' and object_key not like '%..%')
);
create index suite_object_writes_project on aigc.suite_object_writes(user_id,scope,project_id);
create index suite_object_writes_due on aigc.suite_object_writes(scope,next_attempt_at,lease_until) where deleted_at is null;
insert into aigc.suite_object_writes(object_key,user_id,scope,project_id,last_write_at)
  select object_key,user_id,scope,project_id,created_at from aigc.suite_assets where status='ready';
-- 同步原任务只存输入指纹，额外保留其真实输入引用，不新增收费状态。
create table aigc.suite_sync_inputs (
  user_id uuid not null, scope text not null, project_id uuid not null, asset_id uuid not null, sync_id uuid not null,
  primary key(user_id,scope,asset_id,sync_id),
  foreign key(user_id,scope,project_id,asset_id) references aigc.suite_assets(user_id,scope,project_id,id)
);
create index suite_sync_inputs_asset on aigc.suite_sync_inputs(user_id,scope,project_id,asset_id);
create index suite_sync_inputs_task on aigc.suite_sync_inputs(user_id,scope,sync_id);
do $$ declare t text; begin
  foreach t in array array['suite_object_writes','suite_sync_inputs'] loop
    execute format('alter table aigc.%I enable row level security',t);
    execute format('revoke all on aigc.%I from public,anon,authenticated',t);
    execute format('create policy owner_access on aigc.%I to aigc_api using (
      user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and scope=(select current_setting(''aigc.scope'',true))
      and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and m.status=''active''))
      with check (user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and scope=(select current_setting(''aigc.scope'',true))
      and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and m.status=''active''))',t);
  end loop;
end $$;
grant select on aigc.suite_object_writes,aigc.suite_sync_inputs to aigc_api;
grant insert(object_key,user_id,scope,project_id) on aigc.suite_object_writes to aigc_api;
grant update(last_write_at) on aigc.suite_object_writes to aigc_api;
grant insert on aigc.suite_sync_inputs to aigc_api;

-- 以原任务实际留存为准；即使已结算，也保留其输入，直到原服务按原规则移除记录。
create function aigc.suite_object_referenced(k text,u uuid,s text) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from aigc.suite_assets a join aigc.suite_projects p on p.id=a.project_id
      where a.object_key=k and a.purged_at is null and p.purge_started_at is null)
    or exists(select 1 from aigc.image_jobs j where j.user_id=u and j.scope=s
      and (jsonb_path_exists(j.params,'$.** ? (@ == $key)',jsonb_build_object('key',k))
        or jsonb_path_exists(j.provider_params,'$.** ? (@ == $key)',jsonb_build_object('key',k))))
    or exists(select 1 from aigc.suite_sync_inputs i join aigc.suite_assets a on a.id=i.asset_id
      join aigc.sync_credit_jobs j on j.id=i.sync_id and j.user_id=i.user_id and j.scope=i.scope
      where i.user_id=u and i.scope=s and a.object_key=k)
    or exists(select 1 from aigc.suite_bridges b join aigc.suite_assets a on a.id=b.source_asset_id
      where a.object_key=k and (b.expires_at>clock_timestamp()
        or exists(select 1 from aigc.sync_credit_jobs j where j.user_id=u and j.scope=s and j.origin ? 'suiteBridgeId' and j.origin->>'suiteBridgeId'=b.id::text)));
$$;
revoke all on function aigc.suite_object_referenced(text,uuid,text) from public,anon,authenticated,aigc_api;

-- 内部跨账号入口沿用无用户身份的维护事务；浏览器身份与错误环境均被拒绝。
create function aigc.start_expired_suite_cleanup(p_scope text,p_start boolean default true) returns integer
language plpgsql security definer set search_path='' as $$
declare p record; n integer:=0;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null or p_scope is null
    or p_scope is distinct from current_setting('aigc.scope',true) or p_scope not in ('local','preview','production') then
    raise exception '套图清理范围无效' using errcode='42501';
  end if;
  for p in select x.* from aigc.suite_projects x where p_start and x.scope=p_scope and x.deleted_at<=clock_timestamp()-interval '7 days'
    and x.purge_started_at is null
    and not exists(select 1 from aigc.suite_batches b where b.project_id=x.id and b.state in ('queued','running','blocked'))
    and not exists(select 1 from aigc.suite_operations o where o.project_id=x.id and (o.lease_until>clock_timestamp() or o.snapshot->>'phase'='confirming'))
    order by x.deleted_at,x.id limit 4 for update of x skip locked
  loop
    update aigc.suite_projects set purge_started_at=clock_timestamp() where id=p.id;
    n:=n+1;
  end loop;
  -- 空项目或上一轮已完成的项目同样可收尾；保留配置、历史和原任务身份作为删除凭据。
  update aigc.suite_projects x set purged_at=clock_timestamp() where x.scope=p_scope and x.purge_started_at is not null and x.purged_at is null
    and not exists(select 1 from aigc.suite_object_writes w where w.project_id=x.id and w.deleted_at is null);
  return n;
end $$;
create function aigc.claim_suite_object_cleanup(p_scope text)
returns table(object_key text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare w record;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null or p_scope is null
    or p_scope is distinct from current_setting('aigc.scope',true) or p_scope not in ('local','preview','production') then
    raise exception '套图清理范围无效' using errcode='42501';
  end if;
  for w in select o.* from aigc.suite_object_writes o join aigc.suite_projects p on p.id=o.project_id
    where o.scope=p_scope and p.purge_started_at is not null and o.deleted_at is null
      and o.last_write_at<=clock_timestamp()-interval '24 hours' and o.next_attempt_at<=clock_timestamp()
      and (o.lease_until is null or o.lease_until<=clock_timestamp())
    order by o.next_attempt_at,o.object_key limit 20 for update of p,o skip locked
  loop
    if aigc.suite_object_referenced(w.object_key,w.user_id,w.scope) then
      update aigc.suite_object_writes o set next_attempt_at=clock_timestamp()+interval '24 hours' where o.object_key=w.object_key;
      continue;
    end if;
    return query update aigc.suite_object_writes o set lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds'
      where o.object_key=w.object_key returning o.object_key,o.lease_token;
    return;
  end loop;
end $$;
create function aigc.finish_suite_object_cleanup(k text,t uuid,ok boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare w record;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null then raise exception '套图清理范围无效' using errcode='42501'; end if;
  select o.* into w from aigc.suite_object_writes o where o.object_key=k and o.lease_token=t
    and o.scope=current_setting('aigc.scope',true) for update;
  if not found then return false; end if;
  if ok then
    update aigc.suite_object_writes set deleted_at=clock_timestamp(),lease_token=null,lease_until=null where object_key=k;
    update aigc.suite_assets set purged_at=clock_timestamp() where object_key=k;
  else
    update aigc.suite_object_writes set lease_token=null,lease_until=null,next_attempt_at=clock_timestamp()+interval '5 minutes' where object_key=k;
  end if;
  return true;
end $$;
revoke all on function aigc.start_expired_suite_cleanup(text,boolean),aigc.claim_suite_object_cleanup(text),aigc.finish_suite_object_cleanup(text,uuid,boolean) from public,anon,authenticated;
grant execute on function aigc.start_expired_suite_cleanup(text,boolean),aigc.claim_suite_object_cleanup(text),aigc.finish_suite_object_cleanup(text,uuid,boolean) to aigc_api;
