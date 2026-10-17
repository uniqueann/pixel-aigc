-- 桥接仅记录来源和回填事件，不拥有收费状态或派发队列。
create table aigc.suite_bridges (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null, slot_id uuid not null,
  source_version_id uuid not null, source_asset_id uuid not null, snapshot jsonb not null,
  created_at timestamptz not null default now(), expires_at timestamptz not null,
  unique(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id,slot_id,source_version_id) references aigc.suite_versions(user_id,scope,project_id,slot_id,id),
  foreign key(user_id,scope,project_id,source_asset_id) references aigc.suite_assets(user_id,scope,project_id,id)
);
create index suite_bridges_source on aigc.suite_bridges(user_id,scope,project_id,slot_id,source_version_id);
create index suite_bridges_asset on aigc.suite_bridges(user_id,scope,project_id,source_asset_id);
create table aigc.suite_bridge_returns (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null, slot_id uuid not null,
  bridge_id uuid not null, source_kind text not null check(source_kind in ('image_job','sync_credit')), source_id uuid not null,
  ordinal integer not null check(ordinal between 0 and 3), request_id uuid not null, version_id uuid not null,
  unique(user_id,scope,request_id), unique(bridge_id,source_kind,source_id,ordinal),
  foreign key(user_id,scope,project_id,bridge_id) references aigc.suite_bridges(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id,slot_id,version_id) references aigc.suite_versions(user_id,scope,project_id,slot_id,id)
);
create index suite_bridge_returns_version on aigc.suite_bridge_returns(user_id,scope,project_id,slot_id,version_id);
create index suite_bridge_returns_bridge on aigc.suite_bridge_returns(user_id,scope,project_id,bridge_id);
create table aigc.suite_restore_receipts (
  user_id uuid not null, scope text not null, project_id uuid not null, request_id uuid not null, fingerprint text not null,
  primary key(user_id,scope,request_id), unique(project_id),
  foreign key(user_id,scope,project_id) references aigc.suite_projects(user_id,scope,id)
);
create index suite_restore_receipts_project on aigc.suite_restore_receipts(user_id,scope,project_id);
do $$ declare t text; begin
  foreach t in array array['suite_bridges','suite_bridge_returns','suite_restore_receipts'] loop
    execute format('alter table aigc.%I enable row level security',t);
    execute format('revoke all on aigc.%I from public,anon,authenticated',t);
    execute format('create policy owner_access on aigc.%I to aigc_api using (
      user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and scope=(select current_setting(''aigc.scope'',true))
      and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and m.status=''active''))
      with check (user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and scope=(select current_setting(''aigc.scope'',true))
      and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and m.status=''active''))',t);
  end loop;
end $$;
grant select,insert on aigc.suite_bridges,aigc.suite_bridge_returns to aigc_api;
grant select,insert on aigc.suite_restore_receipts to aigc_api;
create index image_jobs_suite_bridge on aigc.image_jobs(user_id,scope,(origin->>'suiteBridgeId'),created_at desc) where origin ? 'suiteBridgeId';
create index sync_jobs_suite_bridge on aigc.sync_credit_jobs(user_id,scope,(origin->>'suiteBridgeId'),created_at desc) where origin ? 'suiteBridgeId';

-- 保持原函数 OID，已有 CHECK 与同步计费函数共同采用可选桥接来源验证。
create or replace function aigc.task_origin_valid(o jsonb,c text default null) returns boolean
language sql immutable set search_path='' as $$
  select case when o->>'entry'='ecommerce' then (
    c='image_edit' and o->>'tool'='ecommerce-suite'
    and (select count(*)=6 from jsonb_object_keys(o))
    and not exists(select 1 from unnest(array['projectId','slotId','batchId','operationId']) k
      where coalesce(o->>k,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
  ) is true when o->>'entry'='workstation' and o ? 'suiteBridgeId' then (
    aigc.task_origin_valid_before_suite(o-'suiteBridgeId',c) and o->>'tool' in ('repaint','smart-edit','retouch','relight')
    and coalesce(o->>'suiteBridgeId','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'
  ) is true else aigc.task_origin_valid_before_suite(o,c) end
$$;
-- 同步表在阶段二仍依赖旧来源函数 OID，本阶段显式更新其 CHECK。
do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint
    where conrelid='aigc.sync_credit_jobs'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%task_origin_valid_before_suite%' loop
    execute format('alter table aigc.sync_credit_jobs drop constraint %I',constraint_name);
  end loop;
end $$;
alter table aigc.sync_credit_jobs add constraint sync_jobs_origin_suite_check check(aigc.task_origin_valid(origin,operation));
