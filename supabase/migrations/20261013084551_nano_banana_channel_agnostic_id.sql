-- 把 Nano Banana 2.1 的历史目录 id 改成与渠道无关的 gemini-nano-banana-2.1。
-- 只替换完整旧 id openrouter:gemini-nano-banana-2.1。上游模型名 google/gemini-nano-banana-2.1 是另一段字符串，不改。
-- 不改 request_fingerprint：应用按新 id 与旧 id 两种指纹接受重放。不改 provider：那是当时实际走的渠道。
-- 不改 updated_at / revision，避免云端草稿被当成更新的版本覆盖。重复执行时 WHERE 不再命中，因此幂等。
-- 全仓核对后会写入该 id 的位置：image_jobs.model_profile_id、预扣 meta.modelProfileId、projects.drafts。
-- 下面的 JSON 列按同一旧字符串做防御性改写，当前写入路径不一定放这个 id。
-- 不改 model_preferences：检查约束只允许邮件模型，写成新 id 会让迁移失败。
-- 不改 task_ui_state、image_job_attempts、image_job_items、sync_credit_jobs：这些表没有该目录 id。

update aigc.image_jobs
set model_profile_id = 'gemini-nano-banana-2.1'
where model_profile_id = 'openrouter:gemini-nano-banana-2.1';

update aigc.image_jobs
set params = replace(params::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where params::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.image_jobs
set provider_params = replace(provider_params::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where provider_params::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.credit_ledger
set meta = replace(meta::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where meta::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.projects
set drafts = replace(drafts::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where drafts::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.projects
set document = replace(document::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where document::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.generations
set input = replace(input::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where input::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.generations
set error = replace(error::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where error::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.user_preferences
set preferences = replace(preferences::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where preferences::text like '%openrouter:gemini-nano-banana-2.1%';

update aigc.email_tasks
set model_profile_id = 'gemini-nano-banana-2.1'
where model_profile_id = 'openrouter:gemini-nano-banana-2.1';

update aigc.email_tasks
set params = replace(params::text, 'openrouter:gemini-nano-banana-2.1', 'gemini-nano-banana-2.1')::jsonb
where params::text like '%openrouter:gemini-nano-banana-2.1%';
