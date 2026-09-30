alter table aigc.sync_requests
  add column route text,
  add column request_id uuid,
  add column transport text,
  add column http_status smallint,
  add column error_code text,
  add column input_bytes integer,
  add column mask_bytes integer,
  add column output_bytes integer,
  add column stage_ms jsonb not null default '{}'::jsonb;

create index sync_requests_retention on aigc.sync_requests(created_at);

create or replace function aigc.purge_expired_sync_requests() returns bigint
language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from aigc.sync_requests
  where (route = 'erase' and created_at < now() - interval '7 days')
     or (route is distinct from 'erase' and created_at < now() - interval '2 hours');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function aigc.purge_expired_sync_requests() from public,anon,authenticated;
grant execute on function aigc.purge_expired_sync_requests() to aigc_api;
