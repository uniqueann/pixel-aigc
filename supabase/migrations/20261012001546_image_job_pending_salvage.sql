-- 缓存读取在截止时间失败时，任务已收口但明细可能仍是 pending；保留只读补收机会。
create or replace function aigc.claim_due_image_job(p_scope text)
returns table(id uuid,user_id uuid,scope text,lease_token uuid)
language plpgsql security definer set search_path='' as $$
declare picked uuid;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null
    or p_scope is null or p_scope is distinct from current_setting('aigc.scope',true)
    or p_scope not in ('local','preview','production') then raise exception '图片维护范围无效'; end if;
  perform pg_advisory_xact_lock(91517008,hashtext(p_scope));
  if (select count(*) from aigc.image_jobs j where j.scope=p_scope and j.capability<>'text_to_video'
    and j.lease_owner='maintenance' and j.lease_until>clock_timestamp())>=4 then return; end if;
  select j.id into picked from aigc.image_jobs j where j.scope=p_scope and j.capability<>'text_to_video'
    and j.expires_at>now() and j.next_poll_at<=now() and (j.lease_until is null or j.lease_until<=clock_timestamp())
    and (j.status in ('queued','processing') or (j.deadline_at>now()-interval '24 hours' and exists(
      select 1 from aigc.image_job_items i where i.job_id=j.id and i.result_object_key is null
        and i.status in ('pending','submitted','processing','expired')
        and (i.provider_task_id is not null or i.submission_attempt_id is not null))))
    order by j.next_poll_at,j.created_at,j.id for update skip locked limit 1;
  if picked is null then return; end if;
  return query update aigc.image_jobs j set lease_token=gen_random_uuid(),lease_owner='maintenance',
    lease_until=clock_timestamp()+interval '120 seconds',updated_at=now() where j.id=picked
    returning j.id,j.user_id,j.scope,j.lease_token;
end $$;
revoke all on function aigc.claim_due_image_job(text) from public,anon,authenticated;
grant execute on function aigc.claim_due_image_job(text) to aigc_api;
