-- 套图槽位缩略图。生产必须先执行本迁移，再部署读取缩略图的应用版本。
-- 列缺失或尚未生成缩略图时，应用退回原图，不能因此拒绝读取。
alter table aigc.suite_assets
  add column thumbnail_object_key text,
  add column thumbnail_bytes bigint;
alter table aigc.suite_assets add constraint suite_assets_thumbnail_object_key_check check (
  thumbnail_object_key is null
  or (
    thumbnail_bytes is not null
    and thumbnail_bytes > 0
    and thumbnail_bytes <= 20971520
    and thumbnail_object_key like 'suite-assets/%'
    and thumbnail_object_key not like '%..%'
    and thumbnail_object_key <> object_key
  )
);
create unique index suite_assets_thumbnail_object_key on aigc.suite_assets(thumbnail_object_key) where thumbnail_object_key is not null;
grant update(thumbnail_object_key, thumbnail_bytes) on aigc.suite_assets to aigc_api;

-- 缩略图对象在资产未清除前视为仍被引用，避免清理先于原图删掉小图。
create or replace function aigc.suite_object_referenced(k text,u uuid,s text) returns boolean
language sql stable set search_path='' as $$
  select exists(select 1 from aigc.suite_assets a join aigc.suite_projects p on p.id=a.project_id
      where a.object_key=k and a.purged_at is null and p.purge_started_at is null)
    or exists(select 1 from aigc.suite_assets a join aigc.suite_projects p on p.id=a.project_id
      where a.thumbnail_object_key=k and a.purged_at is null and p.purge_started_at is null)
    or exists(select 1 from aigc.image_jobs j where j.user_id=u and j.scope=s
      and (jsonb_path_exists(j.params,'$.** ? (@ == $key)',jsonb_build_object('key',k))
        or jsonb_path_exists(j.provider_params,'$.** ? (@ == $key)',jsonb_build_object('key',k))))
    or exists(select 1 from aigc.suite_sync_inputs i join aigc.suite_assets a on a.id=i.asset_id
      join aigc.sync_credit_jobs j on j.id=i.sync_id and j.user_id=i.user_id and j.scope=i.scope
      where i.user_id=u and i.scope=s and a.object_key=k)
    or exists(select 1 from aigc.suite_bridges b join aigc.suite_assets a on a.id=b.source_asset_id
      where a.object_key=k and (b.expires_at>clock_timestamp()
        or exists(select 1 from aigc.sync_credit_jobs j where j.user_id=u and j.scope=s and j.origin ? 'suiteBridgeId' and j.origin->>'suiteBridgeId'=b.id::text)));
$$;
