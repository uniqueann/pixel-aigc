-- 未完成的上传只是尝试，不是资产：允许同一编号在未完成时换成另一张图重新开始。
-- 已完成的资产仍不可覆盖，换图必须使用新编号。
grant update(request_fingerprint,upload_id,temp_key,mime_type,bytes,created_at) on aigc.suite_assets to aigc_api;

-- 清理长期未完成的上传行。临时对象位于 temporary/ 前缀，由存储桶生命周期回收；
-- 这里只移除不再被版本、同步输入或桥接引用的数据库行。
create function aigc.cleanup_expired_suite_uploads(p_scope text) returns integer
language plpgsql security definer set search_path='' as $$
declare n integer:=0;
begin
  if nullif(current_setting('aigc.user_id',true),'') is not null or p_scope is null
    or p_scope is distinct from current_setting('aigc.scope',true) or p_scope not in ('local','preview','production') then
    raise exception '套图清理范围无效' using errcode='42501';
  end if;
  delete from aigc.suite_assets x
    where x.scope=p_scope and x.status='pending' and x.created_at<=clock_timestamp()-interval '24 hours'
      and not exists(select 1 from aigc.suite_versions v where v.project_id=x.project_id and v.asset_id=x.id)
      and not exists(select 1 from aigc.suite_sync_inputs s where s.project_id=x.project_id and s.asset_id=x.id)
      and not exists(select 1 from aigc.suite_bridges b where b.project_id=x.project_id and b.source_asset_id=x.id);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function aigc.cleanup_expired_suite_uploads(text) from public,anon,authenticated;
grant execute on function aigc.cleanup_expired_suite_uploads(text) to aigc_api;
