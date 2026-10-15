/** 仅从当前用户与环境的原始记录投影；摘要不读取正文，不调用业务推进函数。 */
export const TASK_PROJECTION = `
with images as (select * from aigc.image_jobs where user_id=$1::uuid and scope=$2),
 syncs as (select * from aigc.sync_credit_jobs where user_id=$1::uuid and scope=$2),
 emails as (select * from aigc.email_tasks where user_id=$1::uuid and scope=$2),
 ledger as (
  select job_id,case when idempotency_key like 'email:%' then 'email_task' else 'job' end as family,bool_or(kind in ('settle','refund') and charged is not null) as finished,
    max(charged) filter(where kind in ('settle','refund')) as charged
  from aigc.credit_ledger where user_id=$1::uuid and scope=$2 and job_id is not null group by job_id,case when idempotency_key like 'email:%' then 'email_task' else 'job' end
 ), sources as (
  select 'image_job'::text as source_kind,j.id as source_id,j.request_id,j.capability,j.model_profile_id,j.status as state,
   j.requested_count,coalesce(i.completed,0)::int as completed_count,j.error_code,j.warnings,j.origin,
   j.billing_state as original_billing,j.credits_reserved,j.credits_charged as original_charge,
   j.created_at,j.updated_at,j.completed_at,j.expires_at as task_expires_at,
   case when j.capability='text_to_video' and j.status='succeeded' then j.expires_at else null end as result_expires_at,
   coalesce(i.identities,'[]'::jsonb) as result_identity,
   coalesce(j.origin->>'tool',case j.capability
    when 'variation' then 'variation' when 'text_to_image' then 'text-to-image'
    when 'text_to_video' then case when j.params->>'mode'='image_to_video' then 'image-to-video' else 'text-to-video' end
    when 'image_edit' then case
      when ((case when coalesce(j.params->>'referenceImageKey','')<>'' then 1 else 0 end)
        +(case when j.params->'relight' is not null and j.params->'relight'<>'null'::jsonb then 1 else 0 end)
        +(case when jsonb_typeof(j.params->'retouchDirections')='array' then case when jsonb_array_length(j.params->'retouchDirections')>0 then 1 else 0 end else 0 end))>1 then null
      when coalesce(j.params->>'referenceImageKey','')<>'' then 'fusion'
      when j.params->'relight' is not null and j.params->'relight'<>'null'::jsonb then 'relight'
      when jsonb_typeof(j.params->'retouchDirections')='array' and j.params->'retouchDirections'<>'[]'::jsonb then 'retouch'
      else 'smart-edit' end else null end) as tool,j.next_poll_at
  from images j left join lateral (
   select count(*) filter(where status='succeeded' and result_object_key is not null) as completed,
    jsonb_agg(jsonb_build_array(ordinal,result_object_key) order by ordinal) filter(where status='succeeded' and result_object_key is not null) as identities
   from aigc.image_job_items where job_id=j.id and user_id=$1::uuid and scope=$2
  ) i on true
  union all
  select 'sync_credit',j.id,j.id,j.operation,null,
    case when j.state='reserved' then 'processing' when j.state='settled' then 'succeeded'
      when j.error_code='TASK_TIMEOUT' then 'expired' else 'failed' end,
    1,case when j.state='settled' and coalesce(j.result->>'objectKey','')<>'' then 1 else 0 end,
    j.error_code,'{}'::text[],j.origin,j.state,j.credits_reserved,
    case when j.result->>'chargedCredits' ~ '^[0-9]{1,9}$' then (j.result->>'chargedCredits')::int else null end,
    j.created_at,j.updated_at,case when j.state<>'reserved' then j.updated_at else null end,null,null,
    case when j.state='settled' and coalesce(j.result->>'objectKey','')<>'' then jsonb_build_array(j.result->>'objectKey') else '[]'::jsonb end,
    coalesce(j.origin->>'tool',case j.operation when 'erase' then 'remove' else j.operation end),null::timestamptz
  from syncs j
  union all
  select 'email_task',j.id,j.request_id,'email_assist',j.model_profile_id,
    case when j.status='failed' and j.error_code='TASK_TIMEOUT' then 'expired' else j.status end,
    1,case when j.status='succeeded' and coalesce(j.result_text,'')<>'' then 1 else 0 end,
    j.error_code,'{}'::text[],j.origin,j.billing_state,j.credits_reserved,j.credits_charged,
    j.created_at,j.updated_at,case when j.status<>'processing' then j.updated_at else null end,j.expires_at,j.expires_at,
    jsonb_build_array(coalesce(j.result_text,'')<>''),'email-assist',null::timestamptz from emails j
 ), normalized as (
  select s.*,case when original_billing in ('none','legacy_free') then 'none'
   when original_billing='reserved' then 'reserved'
   when l.finished and l.charged between 0 and s.credits_reserved and (s.original_charge is null or l.charged=s.original_charge)
    then case when original_billing='settled' then 'settled'
      when original_billing in ('released','refunded') and l.charged=0 then 'refunded' else 'unknown' end
   else 'unknown' end as billing_state,l.charged as ledger_charge,
   aigc.task_outcome_version(s.source_kind,s.source_id,s.state,s.error_code,s.result_identity) as outcome_version
  from sources s left join ledger l on l.job_id=s.source_id and l.family=case when s.source_kind='email_task' then 'email_task' else 'job' end
 ), presented as (
  select n.*,coalesce(n.outcome_version=u.seen_version,false) as seen,coalesce(n.outcome_version=u.dismissed_version,false) as dismissed,
    to_char(n.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at
  from normalized n left join aigc.task_ui_state u on u.user_id=$1::uuid and u.scope=$2 and u.source_kind=n.source_kind and u.source_id=n.source_id
 )`
