-- 欢迎提示与三个使用事件按账号、运行环境隔离，不保存素材或邮件内容。
create table aigc.user_welcome_state (
  user_id uuid not null references aigc.members(user_id) on delete cascade,
  scope text not null check(scope in ('local','preview','production')),
  credit_notice_seen boolean not null default false,
  starter_card_dismissed boolean not null default false,
  analytics_enabled boolean not null default true,
  primary key(user_id,scope)
);
create table aigc.user_activation_events (
  user_id uuid not null references aigc.members(user_id) on delete cascade,
  scope text not null check(scope in ('local','preview','production')),
  event text not null check(event in ('registration_complete','first_upload','first_generation_success')),
  occurred_at timestamptz not null default now(),
  tool text check(length(tool)<=64),
  primary key(user_id,scope,event)
);
create index user_activation_events_cohort on aigc.user_activation_events(scope,event,occurred_at);

alter table aigc.user_welcome_state enable row level security;
alter table aigc.user_activation_events enable row level security;
create policy owner_access on aigc.user_welcome_state to aigc_api
  using(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members m where m.user_id=user_welcome_state.user_id and m.status='active'))
  with check(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members m where m.user_id=user_welcome_state.user_id and m.status='active'));
create policy owner_read on aigc.user_activation_events for select to aigc_api
  using(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members m where m.user_id=user_activation_events.user_id and m.status='active'));
revoke all on aigc.user_welcome_state,aigc.user_activation_events from public,anon,authenticated;
grant select,insert,update on aigc.user_welcome_state to aigc_api;
grant select on aigc.user_activation_events to aigc_api;

-- 客户端只允许报告首次有效上传，注册和成功事件来自服务端真实账本。
create function aigc.record_first_upload(p_tool text) returns boolean
language plpgsql security definer set search_path='' as $$
declare caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid;
  s text:=current_setting('aigc.scope',true); inserted integer;
begin
  if caller is null or s is null or s not in ('local','preview','production')
    or not exists(select 1 from aigc.members where user_id=caller and status='active')
    or p_tool is null or p_tool not in ('smart-edit','relight','remove','repaint','variation','fusion','outpaint','retouch',
      'bg-remove','watermark','aspect-ratio','pipeline','text-to-image','text-to-video','email-batch') then
    raise exception '使用事件无效';
  end if;
  if exists(select 1 from aigc.user_welcome_state where user_id=caller and scope=s and not analytics_enabled) then return false; end if;
  insert into aigc.user_activation_events(user_id,scope,event,tool)
    values(caller,s,'first_upload',p_tool) on conflict do nothing;
  get diagnostics inserted=row_count;
  return inserted>0;
end $$;
revoke all on function aigc.record_first_upload(text) from public,anon,authenticated;
grant execute on function aigc.record_first_upload(text) to aigc_api;

-- 免费抠图的 0 分成功结算也计入成功；预扣、退款和无成功结果的 0 分结算不计入。
-- 触发器随账本事务提交，后台任务完成及重复轮询都不会造成漏记或重复计数。
create function aigc.capture_activation_ledger() returns trigger
language plpgsql security definer set search_path='' as $$
declare name text; source_tool text;
begin
  if new.kind='grant' and new.idempotency_key='initial' then name:='registration_complete';
  elsif new.kind='settle' and (new.charged>0 or new.meta->>'free'='true') then name:='first_generation_success';
  else return new;
  end if;
  if exists(select 1 from aigc.user_welcome_state where user_id=new.user_id and scope=new.scope and not analytics_enabled) then return new; end if;
  source_tool:=coalesce(new.meta->>'tool',new.meta->>'capability',
    (select coalesce(meta->>'tool',meta->>'capability') from aigc.credit_ledger
      where user_id=new.user_id and scope=new.scope and job_id=new.job_id and kind='reserve'
      order by created_at,id limit 1));
  insert into aigc.user_activation_events(user_id,scope,event,occurred_at,tool)
    values(new.user_id,new.scope,name,new.created_at,left(source_tool,64))
    on conflict do nothing;
  return new;
exception when others then
  -- 统计故障不得使原积分结算失败，告警交给数据库日志排查。
  raise warning '使用事件记录失败，SQLSTATE=%',sqlstate;
  return new;
end $$;
revoke all on function aigc.capture_activation_ledger() from public,anon,authenticated;
create trigger capture_activation_ledger after insert on aigc.credit_ledger
  for each row execute function aigc.capture_activation_ledger();

-- 已有钱包说明此前已经进入过本环境，积分说明只向后续首次登录的账号展示。
insert into aigc.user_welcome_state(user_id,scope,credit_notice_seen)
  select user_id,scope,true from aigc.credit_ledger
    where kind='grant' and idempotency_key='initial' on conflict do nothing;

-- 只回填账本能证明的真实时间；历史上传不可推断，不回填。
insert into aigc.user_activation_events(user_id,scope,event,occurred_at)
  select user_id,scope,'registration_complete',created_at from aigc.credit_ledger
    where kind='grant' and idempotency_key='initial' on conflict do nothing;
insert into aigc.user_activation_events(user_id,scope,event,occurred_at,tool)
  select distinct on(user_id,scope) user_id,scope,'first_generation_success',created_at,
    left(coalesce(meta->>'tool',meta->>'capability'),64)
    from aigc.credit_ledger where kind='settle' and (charged>0 or meta->>'free'='true')
    order by user_id,scope,created_at,id on conflict do nothing;
