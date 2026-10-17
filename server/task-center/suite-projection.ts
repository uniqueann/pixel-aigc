import { TASK_PROJECTION } from './projection.js'

/** 父批次只读汇总原任务与原账本；没有父级预扣，也不读取或推进供应商。 */
const suiteProjection = `, suite_operation_costs as (
 select o.*,n.billing_state as native_billing,n.ledger_charge as native_charge,
  case when o.source_job_id is null then 0 else (o.plan->'item'->>'credits')::int end as reserved,
  case when o.source_job_id is null then 0
    when n.billing_state in ('none','settled','refunded') then coalesce(n.ledger_charge,0)
    when n.source_id is null and l.finished and l.charged between 0 and (o.plan->'item'->>'credits')::int then l.charged else null end as charged,
  case when o.source_job_id is null then 'none' when n.source_id is not null then n.billing_state
    when l.finished and l.charged between 0 and (o.plan->'item'->>'credits')::int then 'settled' else 'unknown' end as child_billing
 from aigc.suite_operations o left join normalized n on n.source_kind='image_job' and n.source_id=o.source_job_id
 left join ledger l on l.job_id=o.source_job_id and l.family='job'
 where o.user_id=$1::uuid and o.scope=$2
), suite_totals as (
 select batch_id,count(*)::int as requested,
   count(*) filter(where jsonb_array_length(snapshot->'appliedVersionIds')>0)::int as completed,
   sum(reserved)::int as reserved,sum(coalesce(charged,0))::int as known_charge,
   case when bool_or(child_billing='unknown') then 'unknown' when bool_or(child_billing='reserved') then 'reserved'
     when sum(reserved)=0 then 'none' when sum(charged)=0 then 'refunded' else 'settled' end as billing,
   jsonb_agg(jsonb_build_array(id,snapshot->'appliedVersionIds',snapshot->>'terminalState',snapshot->>'phase') order by id) as identities
 from suite_operation_costs group by batch_id
), combined as (
 select n.*,null::int as known_charge,null::uuid as suite_project_id from normalized n
 union all
 select 'suite_batch',b.id,b.request_id,'ecommerce_suite',null,
   case b.state when 'queued' then 'queued' when 'running' then 'processing' when 'blocked' then 'processing'
     when 'partial' then 'succeeded' when 'stopped' then 'cancelled' else b.state end,
   t.requested,t.completed,b.snapshot->>'blockedReason','{}'::text[],null::jsonb,
   t.billing,t.reserved,t.known_charge,b.created_at,b.updated_at,(b.snapshot->>'completedAt')::timestamptz,
   null::timestamptz,null::timestamptz,t.identities,'ecommerce-suite',null::timestamptz,
   t.billing,t.known_charge,aigc.task_outcome_version('suite_batch',b.id,
     case b.state when 'partial' then 'succeeded' when 'stopped' then 'cancelled' else b.state end,
     b.snapshot->>'blockedReason',t.identities),t.known_charge,b.project_id
 from aigc.suite_batches b join suite_totals t on t.batch_id=b.id where b.user_id=$1::uuid and b.scope=$2
)`

export function taskProjection() {
  if (process.env.ECOMMERCE_SUITE_ENABLED !== 'true') return TASK_PROJECTION
  return TASK_PROJECTION.replace('), presented as (', `)${suiteProjection}, presented as (`).replace('from normalized n left join aigc.task_ui_state', 'from combined n left join aigc.task_ui_state')
}

/** 折叠只影响列表和活动计数；按原任务身份读取详情、恢复仍可直接访问。 */
export function visibleTaskRows() {
  return process.env.ECOMMERCE_SUITE_ENABLED === 'true'
    ? `(source_kind<>'image_job' or origin->>'entry' is distinct from 'ecommerce' or not exists(
      select 1 from aigc.suite_batches parent where parent.user_id=$1::uuid and parent.scope=$2 and parent.id::text=origin->>'batchId'))`
    : 'true'
}
