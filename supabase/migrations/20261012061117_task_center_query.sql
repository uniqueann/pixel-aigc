-- 来源、展示状态和纯函数只服务于查询；不改变原执行与计费协议。
create function aigc.task_origin_valid(o jsonb, c text default null) returns boolean
language sql immutable set search_path='' as $$
  select o is null or (jsonb_typeof(o)='object' and
    jsonb_typeof(o->'entry')='string' and jsonb_typeof(o->'tool')='string' and case o->>'entry'
      when 'workstation' then o->>'tool'=any(array['smart-edit','relight','fusion','retouch','variation','remove','repaint','outpaint'])
        and not exists(select 1 from jsonb_object_keys(o) k where k not in ('entry','tool'))
      when 'toolbox' then o->>'tool'=any(array['bg-remove','aspect-ratio'])
        and not exists(select 1 from jsonb_object_keys(o) k where k not in ('entry','tool'))
      when 'email' then o->>'tool'='email-assist'
        and not exists(select 1 from jsonb_object_keys(o) k where k not in ('entry','tool'))
      when 'canvas' then o->>'tool'=any(array['text-to-image','variation','text-to-video','image-to-video'])
        and jsonb_typeof(o->'projectId')='string' and jsonb_typeof(o->'sceneId')='string'
        and o->>'projectSource'=any(array['local','cloud']) and length(btrim(o->>'projectId')) between 1 and 150
        and length(btrim(o->>'sceneId')) between 1 and 150
        and not exists(select 1 from jsonb_object_keys(o) k where k not in ('entry','tool','projectId','sceneId','projectSource'))
      else false end
    and (c is null or case c
      when 'image_edit' then o->>'tool'=any(array['smart-edit','relight','fusion','retouch'])
      when 'variation' then o->>'tool'='variation' when 'text_to_image' then o->>'tool'='text-to-image'
      when 'text_to_video' then o->>'tool'=any(array['text-to-video','image-to-video'])
      when 'email_assist' then o->>'tool'='email-assist' when 'erase' then o->>'tool'='remove'
      when 'repaint' then o->>'tool'='repaint' when 'outpaint' then o->>'tool'=any(array['outpaint','aspect-ratio'])
      when 'bg-remove' then o->>'tool'='bg-remove' else false end)) is true;
$$;
revoke all on function aigc.task_origin_valid(jsonb,text) from public,anon,authenticated;
grant execute on function aigc.task_origin_valid(jsonb,text) to aigc_api;
alter table aigc.image_jobs add column origin jsonb check (aigc.task_origin_valid(origin,capability));
alter table aigc.sync_credit_jobs add column origin jsonb check (aigc.task_origin_valid(origin,operation));
alter table aigc.email_tasks add column origin jsonb check (aigc.task_origin_valid(origin,'email_assist'));

-- 原五参数函数保持不变，新调用只在首次创建成功时同事务保存来源。
create function aigc.reserve_sync_credits(p_job uuid,p_operation text,p_hash text,p_version text,p_amount integer,p_origin jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j jsonb; caller uuid:=nullif(current_setting('aigc.user_id',true),'')::uuid; s text:=current_setting('aigc.scope',true);
begin
  if caller is null or s is null or s not in ('local','preview','production') or not aigc.task_origin_valid(p_origin,p_operation)
    or not exists(select 1 from aigc.members where user_id=caller and status='active') then raise exception '同步任务来源无效'; end if;
  j:=aigc.reserve_sync_credits(p_job,p_operation,p_hash,p_version,p_amount);
  if j->>'reused'='false' then
    update aigc.sync_credit_jobs set origin=p_origin where id=p_job and user_id=caller and scope=s;
    j:=j||jsonb_build_object('origin',p_origin);
  end if;
  return j;
end $$;
revoke all on function aigc.reserve_sync_credits(uuid,text,text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function aigc.reserve_sync_credits(uuid,text,text,text,integer,jsonb) to aigc_api;

-- 版本只表示展示内容变化，不作为权限或计费凭证。
create function aigc.task_outcome_version(k text,i uuid,s text,e text,r jsonb) returns text
language sql immutable set search_path='' as $$
  select case when s in ('succeeded','failed','expired','cancelled') then
    'v1:'||md5(jsonb_build_object('kind',k,'id',i,'state',s,'error',case when s='succeeded' then null else e end,'results',r)::text)
    else null end;
$$;
revoke all on function aigc.task_outcome_version(text,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function aigc.task_outcome_version(text,uuid,text,text,jsonb) to aigc_api;

create function aigc.task_center_owned(k text,i uuid) returns boolean
language sql stable set search_path='' as $$
  select case k
    when 'image_job' then exists(select 1 from aigc.image_jobs where id=i and user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true))
    when 'sync_credit' then exists(select 1 from aigc.sync_credit_jobs where id=i and user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true))
    when 'email_task' then exists(select 1 from aigc.email_tasks where id=i and user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true))
    else false end;
$$;
revoke all on function aigc.task_center_owned(text,uuid) from public,anon,authenticated;
grant execute on function aigc.task_center_owned(text,uuid) to aigc_api;
create table aigc.task_ui_state (
  user_id uuid not null references aigc.members(user_id), scope text not null check(scope in ('local','preview','production')),
  source_kind text not null check(source_kind in ('image_job','sync_credit','email_task')), source_id uuid not null,
  seen_version text, seen_at timestamptz, dismissed_version text, dismissed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  primary key(user_id,scope,source_kind,source_id)
);
alter table aigc.task_ui_state enable row level security;
create policy task_ui_owner on aigc.task_ui_state to aigc_api
  using(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members where user_id=task_ui_state.user_id and status='active'))
  with check(user_id=nullif(current_setting('aigc.user_id',true),'')::uuid and scope=current_setting('aigc.scope',true)
    and exists(select 1 from aigc.members where user_id=task_ui_state.user_id and status='active')
    and aigc.task_center_owned(source_kind,source_id));
grant select,insert,update on aigc.task_ui_state to aigc_api;
revoke all on aigc.task_ui_state from public,anon,authenticated;
create index task_ui_cleanup on aigc.task_ui_state(scope,created_at);

create function aigc.purge_task_ui_state() returns bigint
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
        else true end)
    order by x.created_at for update skip locked limit 500);
  get diagnostics n=row_count; return n;
end $$;
revoke all on function aigc.purge_task_ui_state() from public,anon,authenticated;
grant execute on function aigc.purge_task_ui_state() to aigc_api;
