-- 套图元数据使用独立实体，所有普通操作仍由 aigc_api 与账号、环境 RLS 保护。
create table aigc.suite_projects (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references aigc.members(user_id),
  scope text not null check(scope in ('local','preview','production')), create_request_id uuid not null,
  request_fingerprint text not null, config jsonb not null, revision integer not null default 0 check(revision>=0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(user_id,scope,id), unique(user_id,scope,create_request_id)
);
create index suite_projects_list on aigc.suite_projects(user_id,scope,updated_at desc,id desc);
create table aigc.suite_slots (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null,
  key text not null, kind text not null, slot_order integer not null check(slot_order between 0 and 6), enabled boolean not null,
  active_version_id uuid, head_revision integer not null default 0 check(head_revision>=0),
  draft jsonb, draft_revision integer not null default 0 check(draft_revision>=0),
  unique(user_id,scope,project_id,id), unique(project_id,key), unique(project_id,slot_order),
  foreign key(user_id,scope,project_id) references aigc.suite_projects(user_id,scope,id)
);
create table aigc.suite_assets (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null,
  request_fingerprint text not null, upload_id uuid not null, temp_key text not null,
  object_key text not null unique check(object_key like 'suite-assets/%' and object_key not like '%..%'),
  mime_type text not null check(mime_type in ('image/jpeg','image/png','image/webp')),
  bytes bigint not null check(bytes>0 and bytes<=20971520), width integer, height integer, checksum text,
  status text not null check(status in ('pending','ready')), created_at timestamptz not null default now(),
  unique(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id) references aigc.suite_projects(user_id,scope,id),
  check(status='pending' or (width between 1 and 10000 and height between 1 and 10000 and checksum ~ '^[a-f0-9]{64}$'))
);
create index suite_assets_owner on aigc.suite_assets(user_id,scope,project_id,status);
create table aigc.suite_versions (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null, slot_id uuid not null,
  asset_id uuid not null, parent_version_id uuid, version_number integer not null check(version_number>0),
  application_key text not null, snapshot jsonb not null, created_at timestamptz not null default now(),
  unique(user_id,scope,project_id,slot_id,id), unique(project_id,slot_id,version_number), unique(project_id,slot_id,application_key),
  foreign key(user_id,scope,project_id,slot_id) references aigc.suite_slots(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id,asset_id) references aigc.suite_assets(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id,slot_id,parent_version_id) references aigc.suite_versions(user_id,scope,project_id,slot_id,id)
);
create index suite_versions_asset on aigc.suite_versions(user_id,scope,project_id,asset_id);
create index suite_versions_parent on aigc.suite_versions(user_id,scope,project_id,slot_id,parent_version_id);
alter table aigc.suite_slots add foreign key(user_id,scope,project_id,id,active_version_id)
  references aigc.suite_versions(user_id,scope,project_id,slot_id,id);
create index suite_slots_current on aigc.suite_slots(user_id,scope,project_id,id,active_version_id);
-- 单槽位也需要服务端报价与稳定原请求凭据，提前落地编排实体的最小子集；没有后台领取函数。
create table aigc.suite_quotes (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null,
  snapshot jsonb not null, request jsonb not null, expires_at timestamptz not null, accepted_batch_id uuid,
  unique(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id) references aigc.suite_projects(user_id,scope,id)
);
create table aigc.suite_batches (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null,
  request_id uuid not null, request_fingerprint text not null, quote_id uuid not null unique,
  state text not null check(state in ('queued','running','blocked','succeeded','partial','failed','stopped')),
  snapshot jsonb not null, created_at timestamptz not null default now(),
  unique(user_id,scope,project_id,id), unique(user_id,scope,request_id),
  foreign key(user_id,scope,project_id,quote_id) references aigc.suite_quotes(user_id,scope,project_id,id)
);
create unique index suite_batches_active on aigc.suite_batches(user_id,scope,project_id) where state in ('queued','running','blocked');
alter table aigc.suite_quotes add foreign key(user_id,scope,project_id,accepted_batch_id)
  references aigc.suite_batches(user_id,scope,project_id,id);
create index suite_quotes_accepted on aigc.suite_quotes(user_id,scope,project_id,accepted_batch_id);
create table aigc.suite_operations (
  id uuid primary key, user_id uuid not null, scope text not null, project_id uuid not null, batch_id uuid not null,
  slot_id uuid not null, request_id uuid not null, source_job_id uuid, snapshot jsonb not null,
  unique(user_id,scope,request_id), unique(batch_id,slot_id),
  foreign key(user_id,scope,project_id,batch_id) references aigc.suite_batches(user_id,scope,project_id,id),
  foreign key(user_id,scope,project_id,slot_id) references aigc.suite_slots(user_id,scope,project_id,id)
);
create index suite_operations_slot on aigc.suite_operations(user_id,scope,project_id,slot_id);
create index suite_operations_job on aigc.suite_operations(user_id,scope,source_job_id);

do $$ declare t text; begin
  foreach t in array array['suite_projects','suite_slots','suite_assets','suite_versions','suite_quotes','suite_batches','suite_operations'] loop
    execute format('alter table aigc.%I enable row level security',t);
    execute format('revoke all on aigc.%I from public,anon,authenticated',t);
    execute format('create policy owner_access on aigc.%I to aigc_api using (
      user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and scope=(select current_setting(''aigc.scope'',true))
      and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and m.status=''active''))
      with check (user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and scope=(select current_setting(''aigc.scope'',true))
      and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting(''aigc.user_id'',true),'''')::uuid) and m.status=''active''))',t);
  end loop;
end $$;
grant select,insert,update on aigc.suite_projects,aigc.suite_slots,aigc.suite_assets,aigc.suite_batches,aigc.suite_operations to aigc_api;
grant select,insert on aigc.suite_quotes to aigc_api;
grant update(accepted_batch_id) on aigc.suite_quotes to aigc_api;
-- 版本仅允许读取与追加，普通角色不能覆盖或删除历史。
grant select,insert on aigc.suite_versions to aigc_api;

-- 保留原有来源校验，新增具有完整 UUID 上下文的套图来源；任务入口还须验证操作绑定。
alter function aigc.task_origin_valid(jsonb,text) rename to task_origin_valid_before_suite;
create function aigc.task_origin_valid(o jsonb,c text default null) returns boolean
language sql immutable set search_path='' as $$
  select case when o->>'entry'='ecommerce' then (
    c='image_edit' and o->>'tool'='ecommerce-suite'
    and (select count(*)=6 from jsonb_object_keys(o))
    and not exists(select 1 from unnest(array['projectId','slotId','batchId','operationId']) k
      where coalesce(o->>k,'') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$')
  ) is true else aigc.task_origin_valid_before_suite(o,c) end
$$;
revoke all on function aigc.task_origin_valid(jsonb,text) from public,anon,authenticated;
grant execute on function aigc.task_origin_valid(jsonb,text) to aigc_api;
-- 已存在的 CHECK 依赖旧函数 OID，需要显式重建而非仅替换函数名。
do $$ declare constraint_name text; begin
  for constraint_name in select conname from pg_constraint
    where conrelid='aigc.image_jobs'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%task_origin_valid_before_suite%' loop
    execute format('alter table aigc.image_jobs drop constraint %I',constraint_name);
  end loop;
end $$;
alter table aigc.image_jobs add constraint image_jobs_origin_check check(aigc.task_origin_valid(origin,capability));
