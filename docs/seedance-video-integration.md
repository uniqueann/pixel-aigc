# Seedance 视频接入与上线验收

实现一期自由画布文生视频、单张首帧图生视频。供应商是火山方舟 Seedance 2.0 fast，模型 `doubao-seedance-2-0-fast-260128`。生成开关默认关闭；部署代码不等于已经开放视频服务。

## 产品与接口约定

- 固定 720p、5/10 秒、每次 1 条。文生视频支持 `1:1`、`4:3`、`3:4`、`16:9`、`9:16`；图生视频使用 `adaptive` 保持原图比例。
- 声音默认关闭；有声、无声同价。5 秒预扣 50 积分，10 秒预扣 100 积分。以请求中的 `priceVersion` 核对报价，价格过期返回 409。
- 视频通过 `POST /api/tasks` 提交，能力统一为 `text_to_video`，参数 `mode` 区分两种生成。`GET /api/capabilities` 返回 `textToVideo`、`imageToVideo`，`GET /api/video-models` 返回当前开放的模型与价格。
- 图生视频只接收当前账号的 R2 对象键；服务端读取真实静态 JPEG/PNG/WebP，限制 20 MiB、40 百万像素、每边 300–6000 像素、比例 0.4–2.5。客户端地址不能作为供应商输入。
- 首期暂不支持含真人人脸的图片。供应商拒绝时明确提示，整单退款；不新增人脸检测、认证或可信素材库。
- 视频完成后进入画布和“我的资产”。云项目先另存为本地副本；含视频的项目暂时不能保存到云端。生成中的本地画布可以刷新并续接原任务。
- 结果按真实文件记录尺寸、时长、字节数与音轨；只接受 MP4/H.264，音轨为 AAC，最大 100 MiB。不转码。可选末帧生成 320 像素封面，封面失败不影响视频交付。
- 视频保留期从成功交付时起算 30 天。播放、下载经鉴权获取 R2 私有签名地址，最长 15 分钟且不超过保留期；MP4 与封面均不走字节代理。到期后停止签名、移除资产列表中的本地引用，并由后台删除 R2 文件和任务记录。画布保留过期提示，可删除节点。
- 不包含视频上传、剪辑、多参考、首尾帧和 1080p，也不新增工作站入口。

## 后台闭环

复用 `aigc.image_jobs`、`aigc.image_job_items` 以及现有积分账本和结算函数。新增独立 `VideoProvider`，图片任务仍沿用原接口。图片与视频分别统计并发和小时限额。

提交意图与预扣在同一事务落盘，然后只发送一次上游 POST。创建响应不确定时显示“提交确认中”，保留积分预扣，等待签名回调或截止退款；不自动再次创建供应商任务。前端响应丢失时先按原 `requestId` 查询，不使用新请求重试。

回调 URL 的 HMAC 绑定本地任务与运行环境。回调只登记候选上游 ID，不信任回调携带的状态和地址。后台用方舟 API 核实 ID、模型与结果后，再转存和结算。重复回调、分钟补偿与提交响应共享行锁；转存租约使用毫秒精度时间戳作为提交围栏。

| 约束 | 当前值 |
| --- | --- |
| 上游执行期限 | 3600 秒 |
| 本地截止 | 提交后 75 分钟 |
| 首次观察到成功后的转存窗口 | 15 分钟 |
| 转存重试间隔 | 30 / 60 / 120 / 300 秒 |
| 后台租约 | 120 秒 |
| 单次推进预算 | 100 秒；现有函数上限 120 秒 |
| 每用户视频并发 / 小时额度 | 每环境 1 个 / 6 个 |
| 每环境总活跃任务 / 后台推进并发 | 5 个 / 2 个 |
| 超时退款后的免费补回 | 本地截止后 24 小时 |

转存成功才结算。失败或截止退款；超时后的迟到成功沿用已退款状态，免费补回，用户可刷新“我的资产”查看。后台通过确定性的对象路径回收文件，R2 删除失败时保留数据库记录，后续继续清理。

## 部署顺序

1. 保持 `VIDEO_GENERATION_ENABLED=false`。通过 CLI 检查迁移列表与目标项目，再执行数据库迁移：

   ```bash
   npx supabase migration list --linked
   npx supabase db push --linked --dry-run
   npx supabase db push --linked
   ```

   本次迁移是 `20261003080118_aigc_seedance_video_jobs.sql`，仅扩展 `aigc` 任务能力、视频结果元数据、分能力计数和受限后台函数；不新建视频任务表，不修改其他产品或 Auth 触发器。使用具备 DDL 权限的管理员连接，应用的 `aigc_api` 角色不能代替管理员执行迁移。

2. 服务端配置 `.env.example` 中的 `ARK_API_KEY`、`VIDEO_PUBLIC_BASE_URL`、`SEEDANCE_CALLBACK_SECRET`、`VIDEO_CRON_SECRET`，以及现有数据库和 R2 配置。每个环境独立配置密钥与稳定可访问的 HTTPS 地址。不要把密钥放进 `VITE_` 变量、迁移文件或版本库。方舟账号需要开通对应模型。

3. 配置 R2 桶 CORS，覆盖真实站点与需要联调的本地站点。保留既有上传规则；新增读取所需的 GET/HEAD 与 Range：

   ```json
   [{
     "AllowedOrigins": ["https://你的正式域名", "http://localhost:5173"],
     "AllowedMethods": ["GET", "HEAD", "PUT"],
     "AllowedHeaders": ["Content-Type", "Range", "If-Range"],
     "ExposeHeaders": ["ETag", "Content-Length", "Content-Range", "Accept-Ranges", "Content-Type", "Content-Disposition"],
     "MaxAgeSeconds": 3600
   }]
   ```

   使用浏览器实测 206 Range 播放与中文文件名附件下载。桶保持私有。不要给视频生成目录配置早于 30 天的生命周期规则；图生视频原图的临时目录应保证至少两小时可读取。

4. 管理员在 Supabase 启用 `pg_cron`、`pg_net`、`supabase_vault`，使用 Vault 保存补偿入口 URL 与 `VIDEO_CRON_SECRET`。以下是正式环境模板；将占位值替换为真实配置，且不要把替换后的 SQL 放入代码仓库：

   ```sql
   select vault.create_secret('https://你的正式域名/api/internal/video-jobs-maintain', 'aigc_video_maintenance_url_production');
   select vault.create_secret('与正式环境 VIDEO_CRON_SECRET 相同的值', 'aigc_video_maintenance_secret_production');
   select cron.schedule(
     'aigc-video-maintenance-production',
     '* * * * *',
     $cron$
     select net.http_post(
       url := (select decrypted_secret from vault.decrypted_secrets where name='aigc_video_maintenance_url_production'),
       headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
         (select decrypted_secret from vault.decrypted_secrets where name='aigc_video_maintenance_secret_production')),
       body := '{}'::jsonb,
       timeout_milliseconds := 10000
     );
     $cron$
   );
   ```

   Vault 名称每环境唯一；重配时先查已有 Secret ID，通过 `vault.update_secret` 更新，避免重复创建同名密钥。同名 `cron.schedule` 用于更新当前视频调度；不要删除或改写邮件、图片清理以及其他产品的计划任务。预览环境应使用独立名称、密钥和 URL，服务端 `AIGC_RUNTIME_SCOPE` 必须与其一致。后台维护关闭生成开关后仍可处理已有任务。

5. 部署代码后先保持关闭状态，检查公开能力开关和模型列表。内部维护入口是 POST，校验独立 Bearer 密钥并返回 202；内部回调入口也是 POST，无须用户登录，验证任务 HMAC。Vercel Deployment Protection 不能挡住这两个入口的上游与调度访问。

6. 在受控验收环境配置完整服务并打开开关，完成下列真实验收，再开放正式环境。当前开发环境缺少 `ARK_API_KEY`，未执行真实付费生成、远程迁移或调度注册；本地通过不代表此步骤已完成。

## 验收与观测

本地检查：`npm test`、`npm run build`、`npm run lint`。新增测试使用 PGlite 实际执行迁移、RLS、事务、账本与后台函数；供应商和 R2 采用受控替身。现有 MP4 用于真实元数据解析和浏览器解码，不代表方舟结果质量、延迟或云存储性能。

2026-10-03 开发验证记录：

| 验证项 | 结果与边界 |
| --- | --- |
| 自动化测试 | 907 项通过；包含供应商请求映射、迁移、账本、回调、租约、视频恢复与播放生命周期 |
| 构建与静态检查 | `npm run build`、`npm run lint`、`git diff --check` 均通过 |
| 本地浏览器 Mock 流程 | 生成后进入画布，真实解码 5 秒 MP4；播放中关闭预览会暂停并清除视频源；刷新保留画布与草稿 |
| 本地真实模式关闭状态 | 能力开关为 false、模型列表为空；文生与图片派生入口不可提交，页面无运行错误 |
| 云端与真实供应商 | 未执行远程迁移、分钟调度注册或真实付费生成；尚需下列验收 |

正式开放前逐项保存证据：

- 文生 5 秒无声、10 秒有声；单张非真人图生；确认真实输出尺寸/时长/音轨与 R2 文件一致、积分分别预扣并只结算一次。
- 提交后关闭页面，确认回调或分钟补偿仍转存、结算并出现在资产列表；刷新生成中画布只续接原任务。
- 模拟响应丢失、重复回调与重叠调度，确认没有第二次 POST 和第二次扣费。模拟上游拒绝、下载/存储失败、75 分钟截止，核对账本退款与余额。超时后结果补回不得再次收费。
- 两个独立登录账号，加上 production/preview 两环境，验证任务、资产签名和积分隔离；禁止访问已过期视频与封面。
- 浏览器 GET/206 Range、首帧、播放、声音、关闭释放、附件下载、签名续期与 30 天截止。验证旧图片预览与原图对比继续可用。
- 故障恢复：进程在转存后、提交数据库前中断，下一次通过同一路径恢复；租约最多占两个推进名额，超时可恢复；R2 删除失败保留记录，重试成功后再删除任务。

日志阶段包含 `video-submit`、`video-download`、`video-probe`、`video-upload`、`video-poster`、`video-advance` 和 `video-maintenance-complete`；记录任务 ID、错误分类、耗时和字节数，避免打印提示词、密钥或临时签名 URL。分钟维护的 202 仅表示收到请求，必须同时检查函数完成日志、`cron.job_run_details` 与 `net._http_response`，并观测逾期预扣、长时间活跃租约、转存重试和到期回收积压。

官方接口参考：[创建任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh)、[任务查询与保留规则](https://docs.volcengine.com/docs/ark/list-video-generation-tasks-api?lang=zh)、[Supabase 定时调用](https://supabase.com/docs/guides/functions/schedule-functions)、[R2 CORS](https://developers.cloudflare.com/r2/buckets/cors/)。
