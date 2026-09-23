-- 账号资料与个人工作空间仅属于 AIGC；共享 Auth 保持原状。
alter table aigc.members add column display_name text not null default 'AIGC 用户'
  check (char_length(display_name) between 1 and 80);
alter table aigc.members add column updated_at timestamptz not null default now();
grant update(display_name,updated_at) on aigc.members to aigc_api;
create policy member_profile_update on aigc.members for update to aigc_api
  using (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and status='active')
  with check (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and status='active');

create table aigc.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的工作空间' check (char_length(name) between 1 and 80),
  type text not null default 'personal' check (type='personal'),
  owner_id uuid not null unique references aigc.members(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(id,owner_id)
);
create table aigc.workspace_members (
  workspace_id uuid not null references aigc.workspaces(id),
  user_id uuid not null references aigc.members(user_id),
  role text not null default 'admin' check (role='admin'),
  status text not null default 'active' check (status='active'),
  joined_at timestamptz not null default now(),
  primary key(workspace_id,user_id)
);
create index workspace_members_user on aigc.workspace_members(user_id,workspace_id);

-- 存量成员先补齐个人空间，再给项目添加非空归属。
insert into aigc.workspaces(owner_id) select user_id from aigc.members on conflict(owner_id) do nothing;
insert into aigc.workspace_members(workspace_id,user_id)
  select id,owner_id from aigc.workspaces on conflict(workspace_id,user_id) do nothing;
alter table aigc.projects add column workspace_id uuid;
update aigc.projects p set workspace_id=w.id from aigc.workspaces w where p.user_id=w.owner_id;
alter table aigc.projects alter column workspace_id set not null;
alter table aigc.projects add constraint projects_personal_workspace
  foreign key(workspace_id,user_id) references aigc.workspaces(id,owner_id);
create index projects_workspace_updated on aigc.projects(workspace_id,updated_at desc) where deleted_at is null;

create table aigc.member_status_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references aigc.members(user_id),
  previous_status text not null,
  next_status text not null,
  operator text not null,
  reason text not null,
  created_at timestamptz not null default now()
);
create index member_status_events_user_time on aigc.member_status_events(user_id,created_at desc);

alter table aigc.workspaces enable row level security;
alter table aigc.workspace_members enable row level security;
alter table aigc.member_status_events enable row level security;
create policy workspace_owner on aigc.workspaces to aigc_api
  using (owner_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and exists(select 1 from aigc.members m where m.user_id=owner_id and m.status='active')
    and exists(select 1 from aigc.workspace_members wm where wm.workspace_id=id and wm.user_id=owner_id and wm.status='active'))
  with check (owner_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and exists(select 1 from aigc.members m where m.user_id=owner_id and m.status='active')
    and exists(select 1 from aigc.workspace_members wm where wm.workspace_id=id and wm.user_id=owner_id and wm.status='active'));
create policy workspace_member_self on aigc.workspace_members for select to aigc_api
  using (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and exists(select 1 from aigc.members m where m.user_id=aigc.workspace_members.user_id and m.status='active'));
grant select on aigc.workspaces,aigc.workspace_members to aigc_api;
grant update(name,updated_at) on aigc.workspaces to aigc_api;
drop policy owner_access on aigc.projects;
create policy project_member_owner on aigc.projects to aigc_api
  using (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and exists(select 1 from aigc.members m where m.user_id=aigc.projects.user_id and m.status='active')
    and exists(select 1 from aigc.workspace_members wm where wm.workspace_id=aigc.projects.workspace_id and wm.user_id=aigc.projects.user_id and wm.status='active'))
  with check (user_id=nullif(current_setting('aigc.user_id',true),'')::uuid
    and exists(select 1 from aigc.members m where m.user_id=aigc.projects.user_id and m.status='active')
    and exists(select 1 from aigc.workspace_members wm where wm.workspace_id=aigc.projects.workspace_id and wm.user_id=aigc.projects.user_id and wm.status='active'));

-- 旧邀请函数不再是准入入口，取消运行角色权限。
revoke execute on function aigc.claim_invitation() from aigc_api;

create function aigc.initialize_member(p_display_name text default null) returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := nullif(current_setting('aigc.user_id',true),'')::uuid;
  ws uuid;
begin
  if uid is null then return false; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(uid::text));
  insert into aigc.members(user_id,display_name)
    values(uid,coalesce(nullif(left(trim(p_display_name),80),''),'AIGC 用户'))
    on conflict(user_id) do nothing;
  if not exists(select 1 from aigc.members where user_id=uid and status='active') then return false; end if;
  insert into aigc.workspaces(owner_id) values(uid) on conflict(owner_id) do nothing;
  select id into ws from aigc.workspaces where owner_id=uid;
  insert into aigc.workspace_members(workspace_id,user_id) values(ws,uid)
    on conflict(workspace_id,user_id) do nothing;
  return true;
end $$;
revoke all on function aigc.initialize_member(text) from public,anon,authenticated;
grant execute on function aigc.initialize_member(text) to aigc_api;

-- 提交事务时校验个人空间始终由所有者担任有效管理员。
create function aigc.assert_personal_owner() returns trigger language plpgsql
security definer set search_path = '' as $$
declare
  ws uuid;
  owner uuid;
begin
  if tg_table_name='workspaces' then ws := new.id;
  elsif tg_op='DELETE' then ws := old.workspace_id;
  else ws := new.workspace_id; end if;
  select owner_id into owner from aigc.workspaces where id=ws;
  if owner is not null and not exists(
    select 1 from aigc.workspace_members
    where workspace_id=ws and user_id=owner and role='admin' and status='active'
  ) then raise exception '个人空间必须保留有效的所有者管理员'; end if;
  return null;
end $$;
create constraint trigger workspace_owner_required after insert or update on aigc.workspaces
  deferrable initially deferred for each row execute function aigc.assert_personal_owner();
create constraint trigger workspace_members_owner_required after insert or update or delete on aigc.workspace_members
  deferrable initially deferred for each row execute function aigc.assert_personal_owner();
