-- 独立业务命名空间；不修改共享 Auth 和既有 public 表。
create schema aigc;
revoke all on schema aigc from public, anon, authenticated;
create role aigc_api nologin nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
grant usage on schema aigc to aigc_api;

create table aigc.members (
  user_id uuid primary key references auth.users(id),
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now()
);
create table aigc.invitations (
  email text primary key check (email = lower(trim(email))),
  status text not null default 'pending' check (status in ('pending','claimed','revoked')),
  claimed_by uuid references auth.users(id), claimed_at timestamptz,
  created_at timestamptz not null default now()
);
create table aigc.projects (
  id text primary key, user_id uuid not null references aigc.members(user_id),
  name text not null check (length(name) between 1 and 100),
  document jsonb not null, drafts jsonb not null, schema_version integer not null default 1 check (schema_version=1),
  revision integer not null default 1 check (revision>0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  unique(id,user_id)
);
create index projects_owner_updated on aigc.projects(user_id,updated_at desc) where deleted_at is null;
create table aigc.assets (
  id text not null, project_id text not null, user_id uuid not null,
  name text not null, mime_type text not null check (mime_type in ('image/png','image/jpeg','image/webp')),
  size integer not null check (size between 1 and 20971520),
  object_key text not null unique, temp_key text not null unique,
  status text not null default 'pending' check (status in ('pending','ready')),
  width integer, height integer, created_at timestamptz not null default now(),
  primary key(project_id,id), unique(project_id,id,user_id),
  foreign key(project_id,user_id) references aigc.projects(id,user_id),
  check (status <> 'ready' or (width>0 and height>0 and width is not null and height is not null))
);
create table aigc.generations (
  id text not null, project_id text not null, user_id uuid not null,
  capability text not null, input jsonb not null,
  status text not null check (status in ('pending','queued','processing','succeeded','failed','cancelled')),
  provider text, provider_task_id text, request_id text not null,
  parent_generation_id text, retry_of_generation_id text, error jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(project_id,id), unique(project_id,id,user_id), unique(user_id,request_id),
  foreign key(project_id,user_id) references aigc.projects(id,user_id),
  foreign key(project_id,parent_generation_id,user_id) references aigc.generations(project_id,id,user_id),
  foreign key(project_id,retry_of_generation_id,user_id) references aigc.generations(project_id,id,user_id),
  check (id is distinct from parent_generation_id and id is distinct from retry_of_generation_id)
);
create index generations_parent on aigc.generations(project_id,parent_generation_id,user_id);
create index generations_retry on aigc.generations(project_id,retry_of_generation_id,user_id);
create table aigc.generation_assets (
  project_id text not null, generation_id text not null, asset_id text not null, user_id uuid not null,
  role text not null check (role in ('input','output')), ordinal integer not null check(ordinal>=0),
  primary key(project_id,generation_id,role,ordinal),
  foreign key(project_id,generation_id,user_id) references aigc.generations(project_id,id,user_id),
  foreign key(project_id,asset_id,user_id) references aigc.assets(project_id,id,user_id)
);
create index generation_assets_asset on aigc.generation_assets(project_id,asset_id,user_id);

alter table aigc.members enable row level security;
alter table aigc.invitations enable row level security;
create policy member_self on aigc.members for select to aigc_api
  using (user_id = nullif(current_setting('aigc.user_id',true),'')::uuid);
grant select on aigc.members to aigc_api;

-- 仅后端受限角色可领取邀请；邮箱由服务端验证后的 Auth 身份提供。
create function aigc.claim_invitation() returns boolean language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  mail text := nullif(current_setting('aigc.email',true),'');
  claimed text;
begin
  if uid is null or mail is null then return false; end if;
  if exists(select 1 from aigc.members where user_id=uid) then
    return exists(select 1 from aigc.members where user_id=uid and status='active');
  end if;
  update aigc.invitations set status='claimed',claimed_by=uid,claimed_at=now()
    where email=mail and status='pending' returning email into claimed;
  if claimed is null then
    return exists(select 1 from aigc.members where user_id=uid and status='active');
  end if;
  insert into aigc.members(user_id) values(uid) on conflict do nothing;
  return exists(select 1 from aigc.members where user_id=uid and status='active');
end $$;
revoke all on function aigc.claim_invitation() from public,anon,authenticated;
grant execute on function aigc.claim_invitation() to aigc_api;

do $$
declare name text;
begin
  foreach name in array array['projects','assets','generations','generation_assets'] loop
    execute format('alter table aigc.%I enable row level security',name);
    execute format('create policy owner_access on aigc.%I to aigc_api using (user_id = nullif(current_setting(''aigc.user_id'',true),'''')::uuid and exists(select 1 from aigc.members m where m.user_id = nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active'')) with check (user_id = nullif(current_setting(''aigc.user_id'',true),'''')::uuid and exists(select 1 from aigc.members m where m.user_id = nullif(current_setting(''aigc.user_id'',true),'''')::uuid and m.status=''active''))',name);
  end loop;
end $$;
grant select,insert on aigc.projects to aigc_api;
grant update(name,document,drafts,revision,updated_at,deleted_at) on aigc.projects to aigc_api;
grant select,insert on aigc.assets to aigc_api;
grant update(status,width,height) on aigc.assets to aigc_api;
-- 本轮尚未接入真实生成，运行角色不能伪造任务或输出关系。
grant select on aigc.generations,aigc.generation_assets to aigc_api;
