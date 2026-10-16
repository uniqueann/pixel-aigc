# 电商套图数据库与事务设计：阶段一

状态：设计冻结，基线 `55e6040`。本文是后续迁移和真实 PostgreSQL 测试的规范，不是已部署数据库；本阶段不创建可自动执行的迁移文件。关联[共享契约](../shared/ecommerce-suite.ts)、[阶段一契约](ecommerce-suite-phase-one-contract.md)和[故障矩阵](ecommerce-suite-failure-matrix.md)。

## 1. 归属、角色与对象身份

沿用 `aigc` schema、`aigc_api` 应用角色、[withIdentity](../server/db.ts) 的 `aigc.user_id / aigc.scope` 事务局部设置。所有表显式携带 `user_id` 与 `scope`，且读取／更新／删除的 `USING`、新增／更新的 `WITH CHECK` 都要求账号、环境和有效成员一致。

拒绝 `anon / authenticated / PUBLIC` 直接访问这些表或内部函数，只授予服务端实际需要的权限；普通请求不使用绕过 RLS 的角色。JSON Schema 验证只覆盖结构，不替代数据库归属与引用约束。[Supabase RLS 文档](https://supabase.com/docs/guides/database/postgres/row-level-security)

持久对象命名约定为 `suite-assets/<scope>/<userId>/<projectId>/<assetId>.<扩展名>`，缩略图有单独资产 ID。未来生成服务需扩展现有对象校验，同时核对当前运行环境及 `suite_assets` 登记；仅允许路径前缀不构成完整鉴权。存储 Key 是服务端生成字段，客户端写入只提供资产 ID。

## 2. 表与字段

通用列：`id uuid`、`user_id uuid`、`scope text`、时间字段；所有子记录另含 `project_id`。`scope` 只允许 `local / preview / production`。业务相关 JSON 按共享 Schema 校验后保存，数据库另外约束核心身份、状态和非负计数。

| 表 | 主要列 | 核心约束／索引 |
| --- | --- | --- |
| `suite_projects` | `create_request_id`、`request_fingerprint`、配置 JSON、`revision`、`deleted_at` | 归属＋创建请求号唯一；归属＋更新时间＋ID 的列表索引 |
| `suite_slots` | `key / kind / order / enabled`、参考资产、`active_version_id`、`head_revision`、草稿 JSON、`draft_revision` | 同项目 key 和 order 各唯一，order 0～6；API 在项目锁内保证恰好七项及主图规则 |
| `suite_assets` | `object_key / mime_type / width / height / bytes / checksum`、状态、`upload_id / temp_key` | 对象键唯一；同项目资产 ID 唯一；上传许可归属与状态可重入；`temporary/` 不能成为 ready 成品地址 |
| `suite_versions` | `slot_id / version_number / parent_version_id / asset_id`、完整 composition、来源／原结果、`application_key` | 同槽位版本序号唯一；仅生成／回填事件使用非空幂等键唯一；图层编辑允许复用 asset ID |
| `suite_quotes` | `expected_revision`、`plan_fingerprint`、不可变计划 JSON、`total_credits / expires_at`、`accepted_batch_id` | 报价只接受一次，原请求重放返回原批次；归属＋项目＋ID；过期未接受项可清理 |
| `suite_batches` | 原请求号／指纹、`quote_id`、配置快照、预算、状态、`dispatch_deadline_at` | 归属＋请求号唯一；quote ID 唯一；项目活动状态局部唯一索引 |
| `suite_operations` | `batch_id / slot_id / ordinal`、模式、冻结输入、稳定原请求号、阶段、原任务软引用、终态／结果登记快照、租约字段 | 批次＋槽位唯一，归属＋原请求号唯一；待领取时间与状态索引；原结果应用幂等 |
| `suite_bridges` | 来源槽位／版本、输入资产、来源 head 修订、工具、过期时间、回填记录 JSON | 按归属＋ID 查找；回填事件在 `suite_versions.application_key` 再次唯一保护 |

`suite_quotes` 是阶段一对总计划表草案的补齐：报价必须由服务端持久保存，批次接受只提交报价身份／指纹，不能接受前端传入的收费计划。报价表不预扣或结算积分。

### 2.1 复合关联

子表引用父记录时包含 `user_id + scope + project_id`，不能仅以任意 UUID 关联。引用槽位／版本时继续包含 `slot_id`，避免同项目不同槽位的当前指针串联。引用列建立覆盖查询顺序的索引；外键不会自动生成引用侧索引。[PostgreSQL 外键说明](https://www.postgresql.org/docs/current/ddl-constraints.html#DDL-CONSTRAINTS-FK)

示意约束（字段细节以正式迁移及 PostgreSQL 验证为准）：

```sql
-- 父表需有对应复合唯一键，引用同时约束账号、环境与项目。
foreign key (user_id, scope, project_id)
  references aigc.suite_projects (user_id, scope, id);

-- 当前版本必须属于同一槽位，不能只验证版本 UUID 存在。
foreign key (user_id, scope, project_id, id, active_version_id)
  references aigc.suite_versions (user_id, scope, project_id, slot_id, id);
```

创建槽位时当前指针为空，随后创建版本并切指针，解决槽位／版本的互相引用。版本、报价和原任务关联不能随软删除级联删除。硬清理按引用顺序进行，执行前重新验证活动操作和其他项目引用。

### 2.2 原任务软引用

原 `image_jobs` 有独立保留期，不能用 `ON DELETE CASCADE` 外键让套图版本随它清理。写入时在同事务核对原任务归属，并保存 `source_kind / source_id / request_id / ordinal`。结果转存、终态／应用事件与项目长期资产独立保存；费用仍从原账本按原 job ID 查找，不复制一套父批次计费状态。

原任务被清理后，已有原任务 ID、原凭证或终态快照永远不能被解释成“尚未执行”。账本无法查明时显示结算未知，不以 0 或免费代替；结果修复不能再次调用供应商。

## 3. 不可变记录与权限

- 版本内容、确认报价、已接收计划不允许普通配置 PATCH 修改。保存图层创建新版本，引用相同底图合法。
- 配置、草稿、当前指针分别用 `WHERE revision = expectedRevision` 等条件更新并返回新值；未更新任何行时区分无权限和修订冲突，不做盲目 upsert。
- 应用角色不能直接删除已接受报价／操作凭证；清理能力仅授予受保护的维护处理器。权限需要与实际仓储 SQL 一起验证，不能只开 RLS 后默认全表 CRUD。
- 后台领取跨用户任务不能依赖空账号普通 RLS 查询。参照现有图片维护机制设计极窄的内部领取函数：固定空 `search_path`、限制当前环境和允许状态、撤销公共执行权限，仅向应用维护路径开放。不得提供接受任意用户／对象键的通用特权函数。
- 普通业务函数优先调用者权限；内部领取如确需定义者权限，必须有独立越权、跨环境和过期租约测试，不扩大 Data API 角色授权。

## 4. 事务边界与租约

### 4.1 接受批次

1. 在当前账号环境事务中锁项目，再查原请求号；已存在同指纹批次立即返回，同键异参返回冲突。
2. 锁报价，核对同项目、修订、有效期、计划指纹、预算和尚未接受状态。
3. 检查不存在活动批次，插入批次与操作，原任务请求号在此生成并持久化；登记报价接受批次。
4. 整个事务失败则全部回滚。此时不预扣、不调用供应商；禁止接受客户端提交的 `items / creditsCharged / sourceId`。

项目活动状态索引覆盖 `queued / running / blocked`。重新确认未执行项前原子停止旧未派发项并使租约失效；如果旧任务仍待确认，不允许另建收费尝试。

### 4.2 领取与原任务创建

1. 在短事务中领取到期 waiting 项，锁定项目／批次／操作并写入 `lease_token / lease_until / run_id`；同环境使用受限领取，跳过已锁项。
2. 校验停止状态、截止、预算、目录与资产；复制的参数不能发生漂移。模型和费用改变则阻塞，不替用户接受新报价。
3. 在同一 PostgreSQL 事务中调用原图片创建逻辑：原 `reserve`、job、items 与本操作绑定一起提交；不得嵌套开启独立事务后再另存绑定。
4. 事务提交后，由原服务执行供应商调用及 R2 I/O。复用原提交凭证、租约和未知结果恢复，不为套图实现第二套供应商执行器。

锁顺序统一为项目／批次／操作后进入原服务内部顺序；后台投影不能反向持锁跨入配置更新。长时间网络、图像解码与对象转存不放在事务中。[原事务接口](../server/image-jobs/execution.ts)

### 4.3 崩溃、停止与晚到

- 原创建事务回滚：无原 job、无扣费、无绑定，原稳定请求号保留，确认未创建后可继续首次派发。
- 创建已提交但响应丢失：原绑定／原请求找到同一 job，仅修复观察状态；原任务是否已投递供应商由原服务判断。
- 供应商是否接收不明：操作 confirming，禁止创建新 job 或重置请求号。
- 租约过期：新租约领取前查原关联；所有绑定、版本应用与停止写入都校验最新 token，旧执行器不得收尾覆盖。
- 停止与创建竞争：同项目／操作锁使其中一个先完成，已建任务正常执行结算；未建项标停止且使 token 无效。
- 结果登记：转存对象后在短事务验证归属和应用键，保存不可变版本；指针条件不满足时只保存候选。对象写入成功但事务失败进入可重入登记／孤儿清理，不能重做生成。

## 5. 迁移拆分与验证门槛

| 后续阶段 | 迁移／实现内容 | 必须验证 |
| --- | --- | --- |
| 阶段二 | 项目、槽位、资产、版本、草稿修订、复合关联、RLS 与最小权限 | 实际应用角色跨账号／环境拒绝；当前版本串槽位拒绝；修订冲突；软删除与长期对象保护 |
| 阶段三 | 报价、批次、操作、领取／终结函数；来源、UI 约束与原服务同事务扩展 | 最后积分争用、重放、报价只接受一次、同项目并发批次、领取／停止竞争、未知提交与原任务清理 |
| 阶段四 | 桥接及生成／回填应用键约束、版本来源补充 | 同会话同结果幂等、跨归属拒绝、版本过时仅存候选 |
| 阶段五 | 清理索引与受限维护、完整引用保护 | 回收期限、活动任务存在、原账本不可误删、被引用对象不能清理 |

创建正式迁移时先使用已安装 CLI 的帮助确认命令，再通过 `supabase migration new` 生成文件；阶段一不把设计片段写成可自动部署迁移。数据库验收要使用真实 PostgreSQL 和应用角色，PGlite／Schema 测试只能作为补充，不能声称验证生产权限或调度。

已复核 [Supabase 变更索引](https://supabase.com/changelog)中数据库和连接相关变更；本阶段没有数据库连接、扩展、TLS 或远程状态变更。后续实施迁移前需重新核对目标 PostgreSQL／CLI 版本、变更公告和角色权限。
