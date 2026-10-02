-- 每次查询只读取一次身份和环境，保持现有权限边界。
alter policy owner_access on aigc.user_preferences to aigc_api
  using (
    user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid)
    and scope=(select current_setting('aigc.scope',true))
    and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid) and m.status='active')
  )
  with check (
    user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid)
    and scope=(select current_setting('aigc.scope',true))
    and exists(select 1 from aigc.members m where m.user_id=(select nullif(current_setting('aigc.user_id',true),'')::uuid) and m.status='active')
  );
