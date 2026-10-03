-- 视频复用任务与积分账本，仅增加视频元数据和受限的后台调度入口。
alter table aigc.image_jobs drop constraint image_jobs_capability_check;
alter table aigc.image_jobs add constraint image_jobs_capability_check
  check (capability in ('image_edit','text_to_image','variation','inpaint','outpaint','text_to_video'));
alter table aigc.image_job_items add column result_metadata jsonb;
create index image_jobs_video_due on aigc.image_jobs(scope,next_poll_at)
  where capability='text_to_video';

create or replace function aigc.image_processing_count(p_scope text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from aigc.image_jobs where scope=p_scope and capability<>'text_to_video'
    and status in ('queued','processing') and deadline_at>now() and expires_at>now()
$$;

create function aigc.video_processing_count(p_scope text) returns bigint
language sql stable security definer set search_path = '' as $$
  select count(*) from aigc.image_jobs where scope=p_scope and capability='text_to_video'
    and status in ('queued','processing') and deadline_at>now() and expires_at>now()
$$;
revoke all on function aigc.video_processing_count(text) from public,anon,authenticated;
grant execute on function aigc.video_processing_count(text) to aigc_api;

create or replace function aigc.purge_expired_image_jobs() returns bigint
language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from aigc.image_jobs where expires_at<=now() and capability<>'text_to_video';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;

-- 内部接口先验证密钥；数据库函数只允许无用户身份的后台连接调用。
create function aigc.video_job_owner(p_id uuid,p_scope text)
returns table(id uuid,user_id uuid,scope text)
language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is distinct from current_setting('aigc.scope',true) then
    raise exception '仅后台服务可定位视频任务';
  end if;
  return query select j.id,j.user_id,j.scope from aigc.image_jobs j
    where j.id=p_id and j.scope=p_scope and j.capability='text_to_video' and j.expires_at>now()
      and (j.status in ('queued','processing') or j.deadline_at>now()-interval '24 hours');
end $$;
revoke all on function aigc.video_job_owner(uuid,text) from public,anon,authenticated;
grant execute on function aigc.video_job_owner(uuid,text) to aigc_api;

create function aigc.claim_due_video_jobs(p_scope text,p_id uuid default null)
returns table(id uuid,user_id uuid,scope text,lease_until timestamptz,cleanup boolean)
language plpgsql security definer set search_path = '' as $$
declare available integer;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is distinct from current_setting('aigc.scope',true)
    or p_scope not in ('local','preview','production') then raise exception '视频后台环境无效'; end if;
  perform pg_advisory_xact_lock(91517004);
  select greatest(0,2-count(*)::integer) into available from aigc.image_jobs j
    where j.scope=p_scope and j.capability='text_to_video' and j.lease_until>now();
  return query with candidates as (
    select j.id from aigc.image_jobs j
    where j.scope=p_scope and j.capability='text_to_video' and (p_id is null or j.id=p_id)
      and (j.lease_until is null or j.lease_until<=now())
      and (
        j.expires_at<=now()
        or (j.status in ('queued','processing') and (j.next_poll_at<=now() or j.deadline_at<=now()))
        or (j.status='expired' and j.deadline_at>now()-interval '24 hours' and j.next_poll_at<=now()
          and exists(select 1 from aigc.image_job_items i where i.job_id=j.id and i.result_object_key is null
            and (i.provider_task_id is not null or j.provider_params->>'callbackTaskId' is not null)))
      )
    order by j.expires_at,j.next_poll_at limit available for update skip locked
  ), claimed as (
    update aigc.image_jobs j set lease_until=date_trunc('milliseconds',clock_timestamp())+interval '120 seconds'
    from candidates c where j.id=c.id returning j.id,j.user_id,j.scope,j.lease_until,j.expires_at<=now() as cleanup
  ) select * from claimed;
end $$;
revoke all on function aigc.claim_due_video_jobs(text,uuid) from public,anon,authenticated;
grant execute on function aigc.claim_due_video_jobs(text,uuid) to aigc_api;

-- 文件删除成功后才执行；失败时保留任务和确定性的文件路径供下一次回收。
create function aigc.delete_expired_video_job(p_id uuid,p_scope text,p_lease timestamptz) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is distinct from current_setting('aigc.scope',true) then raise exception '仅后台服务可回收视频任务'; end if;
  delete from aigc.image_jobs where id=p_id and scope=p_scope and capability='text_to_video'
    and expires_at<=now() and lease_until=p_lease and billing_state<>'reserved';
  return found;
end $$;
revoke all on function aigc.delete_expired_video_job(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function aigc.delete_expired_video_job(uuid,text,timestamptz) to aigc_api;
