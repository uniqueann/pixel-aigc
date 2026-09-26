# AIGC 后端基础设施

## 当前交付边界

React/Vite 前端与 Vercel Node.js API 共仓库部署。`content-up` 的 `aigc` schema 保存账号资料、个人工作空间、项目和素材元数据；邮箱密码与 Google 登录共用 Supabase Auth，R2 私有桶保存媒体。注册开放，邮箱需验证。邮件助手使用用户自带 DeepSeek 密钥同步生成。智能抠图在 `TENCENT_COS_SECRET_ID`、`TENCENT_COS_SECRET_KEY`、`TENCENT_COS_BUCKET`、`TENCENT_COS_REGION` 四项都配置时，经 `POST /api/bg-remove` 调用数据万象 GoodsMatting。图片工作站、自由画布和转比例扩图的真实生成、额度扣减、视频上传和媒体打包导出仍待接入。

本地默认关闭账号与云端模式。`VITE_AUTH_MODE=enabled` 可独立启用账号，`VITE_CLOUD_MODE=enabled` 启用项目云同步，且要求账号同步启用。账号开启而云同步关闭时，项目仍按 Auth UUID 保存在本地。`POST /api/tasks` 只接受邮件助手。商品抠图是单独接口：四项腾讯云配置齐全时可用，缺配置时 `GET /api/capabilities` 返回 `bgRemove: false`。其余生成能力继续返回未接入提示。

## 邮件助手与用户自带模型密钥

设置弹窗的“模型与密钥”支持每个用户配置自己的 DeepSeek API Key 和默认邮件模型。邮件页面可为单次任务选择 `deepseek-flash` 或 `deepseek-v4-pro`。API Key 经后端调用 DeepSeek `/models` 验证后，以 AES-256-GCM 密文写入 `aigc.model_credentials`；服务端加密主密钥 `AIGC_CREDENTIAL_KEY_V1` 是 32 字节随机值的 Base64 编码，只存本地或 Vercel 服务端环境变量。密文绑定用户、服务商及环境，API 只返回末四位和验证状态，不回显明文。密钥版本字段支持后续轮换；轮换前必须保留旧密钥直到全部密文重加密。`AIGC_RUNTIME_SCOPE` 本地设为 `local`，Vercel 默认使用 `VERCEL_ENV`；共用数据库时生产、预览、本地凭据相互隔离。

`POST /api/tasks` 仅支持 `email_assist`，传 `requestId`、邮件参数和可选的 `modelProfileId`。后端在短事务中验证账号、并发上限和幂等性，建立任务后关闭事务，再以用户密钥调用 DeepSeek；成功或失败均将终态写回。浏览器超时后可以用 `GET /api/tasks/by-request/:requestId` 找回任务。历史列表分页返回摘要，详情才返回邮件正文；用户修改稿与模型原始结果分别保存，超过 7 天不可查询，Vercel 每日任务执行物理清理。`CRON_SECRET` 必须作为服务端环境变量配置，否则清理接口拒绝调用。

用户密钥产生的费用由用户的 DeepSeek 账户承担，不使用 EDM 积分，也没有平台每日免费额度。应用保护上限为每账号同时 1 个任务、全站同时 20 个任务、每账号每小时 60 次；邮件原文不超过 10,000 字符，指导不超过 1,000 字符。服务端日志不记录密钥、邮件原文或生成结果。正式上线前需要对测试账号的自带密钥完成真实调用、余额不足、密钥失效、7 天过期和定时清理验收。

## Supabase 与账号

目标项目：`content-up`（`gnrhyahjegvcicektebh`），区域 `us-west-2`。`aigc` 不加入 exposed schemas，不修改 `public` 原有表、积分或支付逻辑。共享 Auth 的 `handle_new_user` 仍会为新账号创建旧应用免费档案，这是共享用户池的既有行为。

账号迁移新增 `members.display_name`、`workspaces`、`workspace_members` 与状态审计，给项目补充个人空间归属。现有 `invitations` 保留历史记录，但不参与准入。所有业务表开启 RLS；API 角色 `aigc_api` 无登录、无 BYPASSRLS、无成员状态写入或 Generation 写入权限。每个业务事务先切换到该角色，再使用事务局部身份设置执行查询。运行登录角色不得拥有管理员权限或继承旧应用角色。

在 Supabase 启用邮箱注册、邮箱验证、Google Provider 和可正常发信的 SMTP。Google OAuth 应用的重定向地址使用 Supabase 控制台给出的 `/auth/v1/callback`；Supabase 的允许跳转地址加入 `http://127.0.0.1:5173/auth/callback*` 与 `https://aigc.contentup.cc/auth/callback*`，保留旧根路径与其他应用已有条目。恢复邮件须在发起请求的浏览器完成 PKCE 交换。共享验证邮件模板目前将确认链接固定到 ContentUp 的 `/auth/confirm`，因此 AIGC 注册后会在 ContentUp 验证，再返回 AIGC 登录；不要宣称验证邮件直接回到 AIGC。修改共享邮件模板前，需回归 ContentUp 和 EDM。

Google 提供商的客户端标识与密钥只配置到 Supabase 控制台；前端只配置 publishable key。服务端通过 `getUser` 验证身份和邮箱确认状态，随后幂等初始化 AIGC 成员与个人空间。可编辑的 user_metadata 仅用作初始展示名称，不参与授权。AIGC 停用不封禁共享 Auth 账号。

`aigc_server` 受限运行角色已在共享项目创建，具有 `NOINHERIT`、`NOBYPASSRLS`，仅被授予 `aigc_api` 成员资格；不要重复运行 `aigc:bootstrap` 或重置其密码。运行凭据保存在本机权限为 0600 的 `.env.local`。迁移管理员连接 `AIGC_ADMIN_DATABASE_URL` 只供管理命令使用，不部署到 Vercel。

管理员命令：

```sh
npm run aigc:member -- 用户UUID disabled 停用原因
npm run aigc:member -- 用户UUID active 恢复原因
```

`aigc:invite` 已停用。成员状态变化在同一事务中写入审计表，操作者来自 `AIGC_ADMIN_OPERATOR` 或本机用户名。停用成员不删除共享账号；已签发的媒体访问链接最多在 15 分钟后过期。前端退出使用本地会话范围，避免全局注销其他会话。

## 凭据和启动

复制 `.env.example` 为 `.env.local`，填写其中各项。运行 API 使用专用数据库登录角色 `aigc_server`，仅授予 `aigc_api` 角色成员资格，不给管理员权限。Vercel 运行连接需使用 Supabase Connect 页面显示的实际事务池地址（6543）及其用户名格式；不能根据区域猜测池化主机。本机已通过 `aws-1-us-west-2.pooler.supabase.com:6543` 的事务池连接验证 `aigc_server` 登录。密码及完整连接串只存环境变量。

数据库迁移采用 `supabase/migrations` 中的 SQL。已有共享项目不要执行 `db reset`，也不要把其他应用的远端迁移缺失误判为待删除对象。本轮迁移使用命名空间限定的新增 DDL；上线前在本地 PostgreSQL 验证，应用后检查表、RLS 和函数权限。

本地 API 与 Vite 分别启动：

```sh
npm run dev:api
npm run dev
```

Vite 将 `/api` 代理到 `127.0.0.1:8080`。本地 API 进程读取 `.env.local`；修改环境变量后重启两个进程。

Vercel 使用 Node.js 24，Vite 构建，API 在 `api/[...path].ts`。配置函数区域 `pdx1`，靠近数据库；构建包含服务端类型检查。仅配置必要运行变量，不能上传管理员数据库连接。云端开发与试用按约定共用 `aigc`，线上验证使用专用测试账号。

## R2 设置

创建私有桶 `pixel-aigc-media`，不启用公共 `r2.dev`。凭据限定到该桶的对象读写权限。设置 `temporary/` 前缀对象 7 天过期的生命周期规则；正式 `media/` 对象不自动删除。

桶 CORS 示例：用真实域名替换占位，按实际使用补充 localhost 或预览域名，不使用全来源通配符。

```json
[
  {
    "AllowedOrigins": ["http://127.0.0.1:5173", "https://你的应用域名"],
    "AllowedMethods": ["GET", "HEAD", "PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

上传仅支持静态 PNG/JPEG/WebP，最大 20 MB、解码像素最多 4000 万。PUT 签名有效期 10 分钟，绑定类型与大小；完成接口重新读取并核验实际字节，以同一份字节写入不可由客户端覆盖的正式 key，再更新数据库。临时对象保留到生命周期清理，事务失败后可重复完成。GET 签名有效期 15 分钟，前端提前刷新。R2 与 Postgres 无跨服务事务，正式对象写入后数据库失败可能留下孤立对象；重复完成可恢复，本轮不执行永久删除。

## API 契约

除 `GET /api/capabilities` 外，接口要求 Bearer 令牌。`POST /api/me` 幂等初始化个人资料和空间；其他需登录的接口还要求 active 成员。`GET /api/me` 只读、`PATCH /api/me` 只改昵称、`PATCH /api/workspaces/:id` 只改本人个人空间名。响应包含 `userId`、邮箱、昵称、头像、登录方式和个人空间。错误响应为 `{ error, code, requestId }`，日志不记录令牌、签名地址或请求全文。

| 接口 | 输入或行为 |
| --- | --- |
| `GET /api/capabilities` | 无需登录。`bgRemove` 表示四项腾讯云配置是否齐全 |
| `POST /api/bg-remove` | 需登录。`mimeType`、`dataBase64`；JPEG/PNG/WebP，单张不超过 20 MB。返回商品抠图 PNG |
| `GET /api/projects` | 最近更新的 200 个未删除项目 |
| `POST /api/projects` | `id, name, document, drafts, schemaVersion`，先创建无媒体引用的文档；同 ID 初始创建可重试，已有编辑版本拒绝覆盖 |
| `GET /api/projects/:id` | 文档、草稿、revision、可用素材元数据；不返回私有凭据 |
| `PUT /api/projects/:id` | 文档、草稿、`baseRevision`；行锁保护版本校验，冲突 409；不接受任务、所有者或额度字段 |
| `DELETE /api/projects/:id` | 软删除项目，素材读取入口随之拒绝 |
| `POST /api/assets/uploads` | `projectId, assetId, name, mimeType, size`；相同项目和素材 ID 幂等 |
| `POST /api/assets/:id/complete` | `projectId`；重复完成返回已就绪素材 |
| `POST /api/assets/access` | `projectId, assetIds`，每批最多 100 个；验证所有归属后签发 GET URL |

画布请求最大 3 MB、100 个场景、每场景 5000 个节点。首轮 Generation 表只建立结构和关联约束，没有真实任务写入接口；后续接入时必须增加服务端任务执行与结果读取。

## 本地保存与云同步

本地 500 ms 自动保存；云端 2 秒防抖并串行写入。未连接云端的项目由用户点击“保存到云端”上传，之后自动同步。断网保留 pending 和 revision，恢复连接及每分钟补偿重试。

IndexedDB 当前项目与归档按用户隔离，旧匿名 `current` 仅在点击“导入旧本地项目”时读取。云端素材持久化稳定对象引用，签名 URL 与有效期不会写入快照。JSON 仅备份结构，跨账号导入私有素材会被拒绝，需重新选择文件。

冲突返回 409 后保存本地冲突快照，暂停自动覆盖。可以加载云端版本，或把本地内容另存新项目并复制当前用户有权限的媒体。打开项目之前保存本地；读取期间检测本地变化，防止远端响应覆盖新编辑。替换媒体使用新素材 ID。

## 验证与上线资料

`npm test` 覆盖 PGlite 中实际迁移、RLS、开放初始化、成员停用、跨用户外键、上传字节核验、版本冲突、网络重试、账号分区与签名剥离。`npm run lint`、`npm run build` 检查前后端代码。

账号真实联调还需：邮箱注册与验证、至少两个独立测试账号。Google 登录、存量共享账号首次进入、受限数据库连接和个人资料修改已在本机联调通过；共享 SMTP 已启用，AIGC 的生产与本地登录、恢复回调地址已加入 Supabase 允许列表。后续还需验证密码恢复、切换账号、停用恢复，以及 ContentUp 和 EDM 原有登录流程。R2 桶及凭据属于后续云同步与上传联调；自动化测试不能代替真实邮件与 OAuth 验收。

## 本次数据库应用记录

迁移 `20260908094310_aigc_foundation`、`20260923015953_aigc_accounts` 和 `20260923020155_aigc_project_compat` 已应用到 `content-up`，本地文件版本与远端迁移历史一致。兼容迁移给旧项目创建请求自动补齐个人空间并建立复合外键索引。远端核验：账号相关三张表启用 RLS，`aigc_api` 可执行初始化函数且不可再执行邀请函数；原六张业务表依旧启用 RLS，Generation 无运行角色写入权限。

安全顾问对历史邀请表和新状态审计表给出“启用 RLS 但无直接策略”的信息级提示；两表均只允许管理端访问，不应为消除提示而增加开放策略。[顾问说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。原 `public` 函数和 Auth 的既有告警未修改。

旧版曾使用模拟会话验证 Google 入口、云端工具栏及空白项目保存。本轮 Google 登录已通过真实 Supabase Auth 回调，完成成员与工作空间初始化；完整账号验收仍需邮件链路与第二账号的状态切换验证。

Vercel `pixel-aigc` 的 Production 与 Preview 已更新 `AIGC_DATABASE_URL`、`SUPABASE_URL`、`SUPABASE_PUBLISHABLE_KEY` 并新增 `VITE_AUTH_MODE=enabled`；变量更新后需新部署生效。旧版 `VITE_SUPABASE_*` 被保存为不可读取的 Secret，Vercel 现行校验阻止继续以 Secret 更新公开给浏览器的 `VITE_` 值；因此前端优先读取同范围的 `VITE_AIGC_SUPABASE_URL` 和 `VITE_AIGC_SUPABASE_PUBLISHABLE_KEY` Config，旧名称保留为本地回退。回调允许列表保留 ContentUp、EDM 原条目，新增本地与生产 AIGC 的普通登录及密码恢复四个精确地址。

生产域名 `https://aigc.contentup.cc` 已验证：未登录请求 `/api/me` 返回 `401/AUTH_REQUIRED`，现有共享 Google 账号完成 OAuth 回调后显示个人首页与账号资料。共享验证邮件仍按 ContentUp 模板跳转，邮箱注册、恢复邮件以及停用恢复流程尚待独立测试账号验收。
