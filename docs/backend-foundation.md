# AIGC 后端基础设施

## 当前交付边界

React/Vite 前端与 Vercel Node.js API 共仓库部署。`content-up` 的 `aigc` schema 保存项目和素材元数据，Google 登录共用 Supabase Auth，R2 私有桶保存媒体。首轮提供邀请准入、图片上传、项目云同步和冲突保留；真实生成、额度扣减、视频上传和媒体打包导出留待服务商接口确定后接入。

本地默认关闭云端模式。`VITE_CLOUD_MODE=enabled` 时不会执行 Mock 生成，生成入口返回明确的未接入提示。没有登录配置时不要启用该开关。

## Supabase 与账号

目标项目：`content-up`（`gnrhyahjegvcicektebh`），区域 `us-west-2`。`aigc` 不加入 exposed schemas，不修改 `public` 原有表、积分或支付逻辑。共享 Auth 的 `handle_new_user` 仍会为新账号创建旧应用免费档案，这是共享用户池的既有行为。

新增表：`members`、`invitations`、`projects`、`assets`、`generations`、`generation_assets`。所有表开启 RLS；邀请表仅由受限领取函数或管理员访问。API 角色 `aigc_api` 无登录、无 BYPASSRLS、无成员写入或 Generation 写入权限。每个业务事务先切换到该角色，再使用事务局部身份设置执行查询。运行登录角色不得拥有管理员权限或继承旧应用角色。

在 Supabase 启用 Google Provider。Google OAuth 应用的重定向地址使用 Supabase 控制台给出的 `/auth/v1/callback`，Supabase 的允许跳转地址加入实际 Pixel 首页，如 `http://127.0.0.1:5173/` 和正式 HTTPS 域名。保留其他应用的已有跳转配置、Site URL、注册策略和邮件模板。

使用 Google 提供商的公开客户端标识与密钥配置到 Supabase 控制台；前端只配置 publishable key。通过 `getUser` 验证用户、邮箱确认状态和 Google 身份后领取邀请，不能用可编辑的 user_metadata 授权。

先在 `.env.local` 配置管理员事务池连接 `AIGC_ADMIN_DATABASE_URL`，再用 `npm run aigc:bootstrap` 创建受限运行账号。命令将随机密码对应的运行连接串保存到权限为 0600 的 `.env.local`，不会打印密码；已有账号时拒绝隐式轮换。

管理员命令：

```sh
npm run aigc:invite -- tester@example.com
npm run aigc:member -- 用户UUID disabled
npm run aigc:member -- 用户UUID active
```

邀请命令只维护邮箱名单，不发邮件。停用成员不删除共享账号；已签发的媒体访问链接最多在 15 分钟后过期。前端退出使用本地会话范围，避免全局注销其他会话。

## 凭据和启动

复制 `.env.example` 为 `.env.local`，填写其中各项。运行 API 使用专用数据库登录角色（建议 `aigc_server`），仅授予 `aigc_api` 角色成员资格，不给管理员权限。使用 Supabase Connect 页面中的事务池地址（6543），用户名按其池配置填写专用角色和项目 ref。密码及完整连接串只存环境变量。

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

所有接口要求 Bearer 令牌。`POST /api/me` 原子领取邀请；其他接口还要求 active 成员。错误响应为 `{ error, requestId }`，日志不记录令牌、签名地址或请求全文。

| 接口 | 输入或行为 |
| --- | --- |
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

`npm test` 覆盖 PGlite 中实际迁移、RLS、邀请领取、成员停用、跨用户外键、上传字节核验、版本冲突、网络重试、账号分区与签名剥离。`npm run lint`、`npm run build` 检查前后端代码。

真实联调还需：Google Provider、允许跳转的应用域名、Vercel 团队和项目、R2 桶及凭据、受限数据库连接、至少两个 Google 测试邮箱。联调需验证完整登录与换账号、上传与画布导出、跨设备恢复、签名过期、断网与冲突。没有这些配置时，自动化测试不等于云端端到端验收。

## 本次数据库应用记录

迁移 `20260908094310_aigc_foundation` 已应用到 `content-up`，本地文件版本与远端迁移历史一致。远端核验：六张表均开启 RLS，anon/authenticated 无 schema USAGE，anon 无邀请函数 EXECUTE，aigc_api 无 Generation INSERT 权限。

安全顾问新增一条信息级提示：邀请表开启 RLS、没有直接访问策略。这是默认拒绝设计，邀请只经受限函数领取，不应为消除提示而增加开放策略。[顾问说明](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)。原 `public` 函数和 Auth 的既有告警未修改。

浏览器已验证独立测试端口上的 Google 登录入口、受邀成员进入、云端工具栏及空白项目保存状态；使用模拟会话和 API 响应，不能替代真实 OAuth 与 R2 联调。
