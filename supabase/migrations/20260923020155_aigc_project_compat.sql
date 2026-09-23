-- 兼容尚未部署的新 API：旧版项目创建请求没有 workspace_id。
create function aigc.assign_personal_workspace() returns trigger language plpgsql
security definer set search_path = '' as $$
begin
  if new.workspace_id is null then
    select id into new.workspace_id from aigc.workspaces where owner_id=new.user_id;
  end if;
  return new;
end $$;
create trigger project_personal_workspace before insert on aigc.projects
  for each row execute function aigc.assign_personal_workspace();
create index projects_personal_workspace_fk on aigc.projects(workspace_id,user_id);
