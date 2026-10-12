-- 仅供预览所用数据库的管理员在迁移、兼容代码与排空检查完成后执行。
-- 预先启用 pg_cron、pg_net、supabase_vault；通过 Vault 管理界面保存真实值，不提交密钥。
do $check$
begin
  if (select count(*) from vault.secrets where name='aigc_image_maintenance_url_preview')<>1
    or (select count(*) from vault.secrets where name='aigc_image_maintenance_secret_preview')<>1 then
    raise exception '请先配置唯一的图片预览 URL 和维护密钥';
  end if;
  if (select count(*) from vault.secrets where name='aigc_image_maintenance_bypass_preview')>1 then
    raise exception '部署保护密钥名称不能重复';
  end if;
end;
$check$;

-- 同名 schedule 更新当前图片调度；不删除其他业务的任务。
select cron.schedule(
  'aigc-image-maintenance-preview',
  '* * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='aigc_image_maintenance_url_preview'),
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='aigc_image_maintenance_secret_preview')
    ) || coalesce((select jsonb_build_object('x-vercel-protection-bypass',decrypted_secret)
      from vault.decrypted_secrets where name='aigc_image_maintenance_bypass_preview'),'{}'::jsonb),
    body := '{"scope":"preview"}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);
