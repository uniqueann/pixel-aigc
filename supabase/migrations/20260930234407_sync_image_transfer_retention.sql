create or replace function aigc.purge_expired_sync_requests() returns bigint
language plpgsql security definer set search_path = '' as $$
declare deleted_count bigint;
begin
  delete from aigc.sync_requests
  where (route in ('erase', 'repaint', 'outpaint') and created_at < now() - interval '7 days')
     or ((route not in ('erase', 'repaint', 'outpaint') or route is null) and created_at < now() - interval '2 hours');
  get diagnostics deleted_count = row_count;
  return deleted_count;
end $$;
revoke all on function aigc.purge_expired_sync_requests() from public,anon,authenticated;
grant execute on function aigc.purge_expired_sync_requests() to aigc_api;
