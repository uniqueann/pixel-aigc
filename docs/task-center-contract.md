# 任务中心契约：阶段 1

| 项目 | 内容 |
| --- | --- |
| 状态 | 阶段 1 文档交付，契约已确定；新增字段、接口、适配器与运行层尚未实现 |
| 基线 | 2026-10-11，`main` / `55c36aaa59f42ab2da8c11902bbd4946ef0ffedd` |
| 关联 | [总开发计划](task-center-development-plan.md)、[故障基线与验收清单](task-center-failure-matrix.md) |
| 方案 | 全局侧栏最近任务、共用历史抽屉、工具页筛选入口 |
| 本阶段范围 | 核对现状并冻结契约；交付文档、脱敏样例与故障复现，不改业务代码或数据库 |

文中的“当前”有本地代码证据；“目标契约”供后续实现。生产存储配置与真实供应商行为没有因本阶段文档交付而完成验收。

## 1. 在线任务登记表

所有路径以 `/api` 为前缀。登记的是已经发送到服务端的单项；尚未提交的本地批量队列不属于服务端任务。

| 工具与入口 | 当前提交 | 任务源与原始能力/操作 | 当前查询、恢复与结果 |
| --- | --- | --- | --- |
| 工作站智能编辑 | `POST /tasks` | `image_jobs` + `image_job_items`；`image_edit` | `GET /tasks/:id`；原图对象与参数保存在任务，当前页面控制器持有等待上下文 |
| 工作站重新打光 | 同上 | `image_edit`，`params.relight` | 同上；可按保存的打光参数识别操作 |
| 工作站融合 | 同上 | `image_edit`，`params.referenceImageKey` | 同上；保存商品图和参考图的对象身份 |
| 工作站精修 | 同上 | `image_edit`，非空 `params.retouchDirections` | 同上；保留精修方向 |
| 工作站裂变 | 同上 | `variation` | 同上；刷新后页面内存上下文丢失 |
| 画布文生图 | 同上 | `text_to_image` | 本地 `GenerationRecovery` 提交前落盘，取得任务编号后再次落盘；恢复查询并替换占位图 |
| 画布裂变 | 同上 | `variation` | 同上；`variation` 本身不能证明属于工作站还是画布 |
| 画布文生/图生视频 | 同上 | 同一个 `image_jobs`，`text_to_video`；`params.mode` 区分图生 | 现有视频维护器和回调推进；原项目恢复、视频预览及视频资产登记 |
| 工作站消除 | `POST /erase` | `sync_credit_jobs`；`operation=erase` | `GET /credits/sync/:billingRequestId`；同步结果先写 R2，再收口；页面保存后进入本地资产历史 |
| 工作站重绘 | `POST /repaint` | 同上；`operation=repaint` | 同上 |
| 工作站扩图 | `POST /outpaint` | 同上；`operation=outpaint` | 同上；无需留白的本地处理分支不创建在线任务 |
| 工具箱抠图 | `POST /bg-remove` | 同上；`operation=bg-remove`，含免费额度任务 | 同上；已完成透明 PNG 和队列快照可在本机恢复，进行中请求不是已持久化队列项 |
| 工具箱转比例智能扩展 | `POST /outpaint` | 同上；`operation=outpaint` | 已提交项复用同步结果；未提交的整批 File 队列不自动重建 |
| 邮件单项及 CSV 已提交行 | `POST /tasks` | `email_tasks`；`email_assist` | `GET /tasks/:id`、按请求查询及现有邮件控制器；结果文本与修改稿分开保存 |

计费事实分别来自图片的 `BillingPort reserve/settle/release`、同步工具的 `reserve_sync_credits/finish_sync_credits`、邮件的 `reserve_email_credits/finish_email_task`，最终均使用既有积分账户和账本。适配层不得重新计算价格、再次预扣或另建计费流程。

入口证据：[工作站注册表](../src/features/image-workstation/tools/registry.ts)、[请求构造器](../src/features/image-workstation/tools/requestBuilders/fusion.ts)、[任务分流](../server/handler.ts)、[画布控制器](../src/features/free-canvas/generation/useFreeCanvasGenerationController.ts)、[抠图历史](../src/pages/Toolbox/bg-remove/history.ts)、[智能扩展](../src/pages/Toolbox/AspectRatioTool.tsx)、[邮件批处理控制器](../src/features/email-assistant/batch/useEmailBatchController.ts)。

水印、普通转比例、当前本地批量流水线、主体检测和智能选区不进入本期服务端生成任务列表；辅助检测记录不等于生成任务。Mock 行为单独标记，不能代替在线任务和真实扣费验收。

## 2. 任务身份与来源

### 2.1 稳定身份

| 字段 | 冻结规则 |
| --- | --- |
| `sourceKind` | `image_job` / `sync_credit` / `email_task`；视频属于 `image_job` |
| `sourceId` | 原任务表的 UUID 主键，不由展示层重新生成 |
| `taskKey` | `${sourceKind}:${sourceId}`，用于路由与结果关联 |
| `requestId` | 图片/邮件取原 `request_id`；同步工具取 `sync_credit_jobs.id`，它就是原 `billing.requestId` |
| 缓存身份 | `userId + runtimeScope + taskKey`；查找待确认提交使用同一账号环境下的 `sourceKind + requestId` |
| 结果身份 | 图片/视频使用原任务编号、稳定结果序号及对象键；同步单项序号固定为 0；签名 URL 不参与身份计算 |

当前工作站 `completeSync` 另外生成一个页面 UUID；HTTP `X-Request-Id` 也是独立追踪编号，R2 临时对象可能含此编号。这两类编号不能替代计费请求编号。不能从对象文件名反推任务编号，必须读取原记录的结果描述。

图片/邮件请求幂等依赖原用户、环境和 `request_id`；同步请求编号还会在函数内验证用户、环境、操作和指纹。邮件记录删除后保留账本请求凭据；图片记录被清理后的按请求定位能力不能假定永久存在。记录消失或原请求过期时，不得自动重放收费请求。

身份证据：[图片表定义](../supabase/migrations/20260928120000_aigc_image_jobs.sql)、[同步预留函数](../supabase/migrations/20261004152128_aigc_credit_payments.sql)、[同步页面控制器](../src/features/image-workstation/hooks/useImageWorkstationController.ts)、[对象写入](../server/handler.ts)、[结果身份](../src/features/assets/resultIdentity.ts)、[邮件服务](../server/email-tasks.ts)。

### 2.2 新增来源的目标契约

新增可空 `origin`，在新提交请求顶层传入，并与原任务创建同事务保存。原请求不传时仍兼容；不会把 origin 放进供应商参数或 `billing` 报价对象。

| `entry` | 允许的 `tool` | 可额外保存的字段 |
| --- | --- | --- |
| `workstation` | `smart-edit`、`relight`、`fusion`、`retouch`、`variation`、`remove`、`repaint`、`outpaint` | 无 |
| `canvas` | `text-to-image`、`variation`、`text-to-video`、`image-to-video` | `projectId`、`sceneId`、`projectSource: local/cloud` |
| `toolbox` | `bg-remove`、`aspect-ratio` | 无 |
| `email` | `email-assist` | 无；批次父任务另行规划 |

画布的新来源必须带齐项目、场景和项目来源；它们是最长 150 字符的非空不透明标识，不能因为本地标识不是 UUID 而拒绝。非画布来源不接收画布字段，所有来源均不接收任意 URL、用户/环境身份、原图、蒙版、文件名或邮件正文。

摘要 `tool` 使用上述工具短标识，`origin.entry` 区分入口；历史 `tool` 筛选表示同一种操作，工具页“本工具任务”按工具短标识筛选。来源是否足以安全直达，由 `origin` 决定，不能由筛选结果反推。

新增来源须排除在三类生成内容指纹之外。同步指纹当前只排除 `billing/clientTimingMs`，后续添加 origin 时必须同步排除；新旧提交均保留原生成参数的冲突检查。同一请求的来源首次写入后不被重入请求覆盖，也不回填猜测的画布身份。

### 2.3 旧记录定位规则

- `image_edit`：使用与现有业务一致的解析器识别参考图、打光和精修标记；唯一有效标记对应融合/打光/精修，无标记为智能编辑。多个互斥标记属于异常旧数据，回退任务详情。当前提交端已经拒绝这类组合。
- `variation`：可确定操作是裂变，来源保持 `null`，不能默认打开某个画布项目。
- `text_to_image`、`text_to_video`：可提供对应画布工具的显式打开入口；缺少项目来源时先看详情，不自动切换项目。视频按原 `params.mode` 区分文生/图生。
- 同步操作可以识别消除、重绘、抠图；`outpaint` 缺来源时不能区分工作站扩图和工具箱智能扩展，保留扩图结果详情及显式工作站入口。
- 邮件可提供邮件任务入口；不能据此重新导入 CSV 或执行尚未提交的行。

## 3. 三个状态维度

### 3.1 执行状态

新摘要 `state` 固定为 `queued/processing/succeeded/failed/expired/cancelled`。部分成功用数量与 `partial` 表达，不增加一个新的数据库任务终态。

| 来源原状态 | 新摘要状态 | 说明 |
| --- | --- | --- |
| 图片/视频原任务状态 | 同名映射 | 直接读取数据库 `expired`，不经过旧前端的 `failed` 映射 |
| 同步 `reserved` | `processing` | 表示原请求仍未收口，不表示后台将重新执行同步操作 |
| 同步 `settled` | `succeeded` | 结果描述缺失时仍保留源状态，结果可用性标为异常不可用 |
| 同步 `refunded` + `TASK_TIMEOUT` | `expired` | 积分数额另行判断，可能是免费任务 |
| 同步其他 `refunded` | `failed` | 展示源错误码，不自动重提 |
| 邮件 `processing/succeeded` | 同名映射 | 修改稿不改变生成状态 |
| 邮件 `failed` + `TASK_TIMEOUT` | `expired` | 其余失败保持 `failed` |

数量规则：图片/视频使用原 `requested_count` 与原子项成功数；同步和邮件单项请求数为 1。图片成功数要求成功项具有原结果对象身份，邮件成功数要求原生成文本存在；缺失结果作为数据异常，不伪造输出。`partial=true` 仅在成功终态且 `0 < completedCount < requestedCount` 时成立，进行中“2/4”仍是处理中。

成功摘要的 `errorCode` 为 null，旧超时错误保留在详情原记录中；源 `warnings` 保留 `PARTIAL`、`LATE_RESULT_NO_CHARGE` 等说明。迟到成功不能因为原超时错误仍在数据库中而显示红灯，也不能让原退款状态消失。

绿灯对应成功；部分完成使用绿灯、提示图标和明确数量。失败/超时使用红灯；排队/处理使用黄灯；取消使用灰灯。没有真实供应商进度就不显示百分比。

客户端断网、查询超时与“提交结果待确认”使用独立 `clientState`，不能作为原任务的 `state` 写入。保留上次成功快照并标注过时；无快照时不虚构服务器任务。灰色提示不等于已经失败、已经取消或已经退款。

映射证据：[图片状态归约](../server/image-jobs/state.ts)、[视频展示](../server/video-jobs/service.ts)、[同步结果读取](../server/sync-billing.ts)、[邮件收口迁移](../supabase/migrations/20261009105115_email_platform_models.sql)。

### 3.2 积分状态

目标 `billingState` 固定为 `none/reserved/settled/refunded/unknown`。它是原记录的展示投影，不能被任务灯色、客户端错误或是否下载成功覆盖。

| 原状态 | 目标值 | 金额与文案 |
| --- | --- | --- |
| 图片 `none`、邮件 `legacy_free` | `none` | 无需扣分；不猜测历史不存在的费用 |
| 各来源 `reserved` | `reserved` | 结算尚未确认；收费显示“预留 N 积分”，零分抠图显示“免费额度处理中” |
| 各来源 `settled` | `settled` | 显示原实际扣分；零分显示“免费” |
| 图片 `released`、同步/邮件 `refunded` | `refunded` | 有正金额才显示退回 N 积分；零分显示“未扣积分” |
| 未识别或记录不一致 | `unknown` | 显示积分状态待核对，不宣称已扣/已退 |

`creditsReserved` 取原记录；终态结算金额取原任务收费字段或同步结果的 `chargedCredits`，与现有账本核对。`creditsReturned` 表示已退差额，部分成功的已结算任务也可能大于 0。预留中的实际扣分与退回金额为 `null`，不能把数据库初始 0 宣传成最终费用。

已收口时按已核验的原账本金额展示；原结果含扣分金额且与预留和流水一致时，可以取 `reserved - charged` 作为退差额。缺少足够凭据则金额为 `null` 并提示核对，不能靠供应商价格或页面报价补猜。

免费抠图有真实同步任务记录，最新迁移会写入 `delta=0` 流水。免费失败的原数据库状态可以叫 `refunded`，但 UI 不出现“退还 1 积分”等虚假金额。[免费同步流水迁移](../supabase/migrations/20261004222317_aigc_free_sync_credit_ledger.sql)

### 3.3 结果可用性与保留时间

`resultAvailability` 固定为 `pending/available/expired/unavailable`：未产出可用描述为等待；已保存结果身份可供读取为可用；有明确有效期证据的失效为过期；对象不存在、暂时不可读取或记录异常为不可用。摘要中的 available 表示有可读取描述，不等于每次轮询都实查 R2。

详情/下载读取发现对象缺失时更新可用性，不改写执行成功或积分事实。缺乏删除原因证据时文案为“结果已失效或不存在”，不能仅凭 404 确定是生命周期过期。签名链接到期后重签原对象，不重新生成。

| 对象 | 当前代码约定 | 本阶段证据边界 |
| --- | --- | --- |
| 图片任务记录 | 默认创建后 30 天，查询检查 `expires_at` | 来自迁移与查询代码；不能推出图片对象拥有相同物理 TTL |
| 视频记录与结果 | 成功时将有效期设为成功后 30 天；维护器领取过期记录并删除视频对象 | 代码具备清理路径；正式站实际清理与真实生成链路仍须验收 |
| 邮件任务与文本 | 默认创建后 7 天；清理先收口再删内容，保留账本 | 不将账本保留期当作邮件正文保留期 |
| `sync_credit_jobs` | 当前表无 `expires_at`，记录不因临时对象 7 天策略自动消失 | 不把同步任务历史固定说成只保留 7 天 |
| 同步 `sync_requests` 耗时记录 | 四种同步图像操作保留 7 天 | 此迁移清理的是性能记录，不是计费任务或 R2 结果 |
| `temporary/` 结果对象 | 项目发布文档要求 R2 生命周期为 7 天 | 本阶段未实时读取桶策略，标记生产配置待复核，不写已验证有效期 |
| 签名读取地址 | 常用 900 秒；视频取剩余保留时间与 900 秒较小值 | 签名成功不会证明对象存在；`expiresAt` 是地址期限 |
| 本地已保存素材 | 按原 IndexedDB 历史、账号范围及删除规则管理 | 服务端对象失效不直接删除本机字节；本机记录存在也不证明字节仍可读 |

目标 DTO 分别使用 `taskExpiresAt`、`resultExpiresAt` 和详情结果的 `urlExpiresAt`。未知对象期限为 `null`。统一历史默认读取最近 30 天内仍保留的记录，不延长任何原正文/对象保留期。

证据：[视频保留常量](../shared/video-models.ts)、[图片收口](../server/image-jobs/service.ts)、[邮件表](../supabase/migrations/20260923102829_aigc_email_byok.sql)、[同步耗时清理](../supabase/migrations/20261001120433_bg_remove_transfer_retention.sql)、[R2 发布约定](bg-remove-transfer-rollout.md)、[存储签名](../server/storage.ts)。

## 4. 最小接口与恢复契约

### 4.1 摘要与详情

目标摘要至少提供以下字段；本阶段仅在文档中定义，不创建共享代码类型：

| 字段组 | 字段与规则 |
| --- | --- |
| 身份与分类 | `sourceKind/sourceId/taskKey/requestId/tool/capability/modelProfileId`；不适用的模型、无法推导的工具为 `null` |
| 执行 | `state/requestedCount/completedCount/partial/errorCode/warnings`；字段来自服务端，不混入断网状态 |
| 积分 | `billingState/creditsReserved/creditsCharged/creditsReturned`；未确认金额可空 |
| 结果 | `resultAvailability/resultExpiresAt`；不带图片、文本正文、对象键及签名地址 |
| 来源与时间 | `origin/createdAt/updatedAt/completedAt/taskExpiresAt`；不存在的完成时间与有效期为 `null` |
| 展示 | `outcomeVersion/seen/dismissed`；进行中没有终态版本 |

详情由 `task` 摘要、可恢复的原参数以及按图片/视频/文本区分的 `results` 构成。图片/视频描述按需含原对象键、序号、格式、尺寸、签名地址和 `urlExpiresAt`；文本只有在获授权的详情读取中返回。同步参数不足时返回 `params=null`，不能伪造原图和蒙版；邮件修改稿与原结果分开。

`outcomeVersion` 在服务端由原任务身份、执行终态、错误码及稳定结果身份生成稳定摘要；邮件用原文本结果是否存在，不使用修改稿。签名 URL、查询时间、积分刷新、结果到期和邮件编辑不触发新的完成通知；迟到图片改变终态或结果身份时生成新版本。已查看/隐藏绑定版本，进行中不能隐藏。

### 4.2 接口职责

| 目标接口 | 固定行为 |
| --- | --- |
| `GET /task-center?view=sidebar` | `{items,activeCount,unseenCount,snapshotAt}`；最多 5 条，进行中优先，其余为近期未查看终态 |
| `GET /task-center?view=history&tool=...&state=...&cursor=...` | `{items,nextCursor,snapshotAt}`；每页默认 20，最大 50；按创建时间、来源类型、主键倒序，游标绑定筛选与首次时间上界 |
| `GET /task-center/by-request/:kind/:requestId` | 返回找到的原任务摘要；未找到 404，能证明原记录过期时 410；不能据 404 自动提交 |
| `GET /task-center/:kind/:id` | 原任务详情与原结果签名；验证用户、成员状态、环境及来源类型 |
| `PATCH /task-center/:kind/:id/presentation` | 接收 `action=seen/dismiss` 与观察到的 `outcomeVersion`；版本已变返回 409 并要求刷新，仅改展示记录 |

所有 GET 只读任务和账本；允许签名读取与按需验证已有对象，不调用供应商生成、查询推进、补提交、退款或素材登记。分页与侧栏优先级查询分开。接口沿用既有私有缓存策略，来源/标识非法为 400；无权与不存在使用相同不可访问响应，不能泄露他人任务是否存在。

### 4.3 当前接口副作用清单

| 当前接口/方法 | 当前副作用 | 后续适配要求 |
| --- | --- | --- |
| `/tasks` 未指定能力的 GET | 默认进入邮件分流，邮件读取之前可能超时收口 | 不能充当全任务列表 |
| 图片 `loadImageTask` / 按请求查询 | 超时收口、领取租约、补提交、上游查询、结果转存和结算 | 提取只读快照，不直接套用旧详情函数 |
| 图片 `listImageTasks` | 集合读取及视频描述适配 | 可复用原查询规则，但需统一字段与三源投影 |
| 同步 `getSyncCreditResult` | 先调用 `expire_sync_credits()`，再读取、重签 | 新只读详情必须拆开收口调用与纯读取 |
| 邮件集合、详情、按请求读取 | 路由统一先执行 `expire_email_tasks(scope)` | 新查询不能套用带过期收口的路由 |
| 前端资产 hydration | 读取成功任务并补记本地素材历史 | 只读侧栏不能为了取摘要触发本地资产写入 |

### 4.4 刷新与点击

有编号时绑定原任务并读取；没有编号时使用原请求查询并合并本地凭据，不能额外创建虚假的服务端任务编号。

非画布最小本地凭据为 `owner/scope/sourceKind/requestId/origin/createdAt`，它不是执行队列，不保存原图、蒙版、CSV 或正文。客户端待确认单独表示为 `clientState=submission_unknown, serverTask=null`，不伪装成 queued 服务器任务。画布继续使用原 `GenerationRecovery`。

画布用户点击“继续”时，当前代码先查原请求；确认未找到后可用同一幂等键重放原请求。此动作是用户明确触发，不能由任务中心自动执行；已找到时只绑定原任务。代码中的真实任务分支禁用自动收费重试，Mock 自动重试不能作为线上策略。

统一定位参数为 `task=<sourceKind>:<sourceId>`。工作站和工具箱进入对应原路由；画布携带原 `projectId/projectSource`，经过 `ProjectOpenGate` 后定位场景，保留 task 参数；邮件打开原单项。不因点击覆盖未保存输入/文本/蒙版，不启动剩余批量队列，不新建画布替代无法打开的原项目。来源缺失或项目被门禁阻止时先展示只读详情。

同步结果可显式成为新编辑输入；不承诺还原原蒙版。新生成失败后的重试使用新请求并确认积分；原任务查询、签名刷新和转存重试不重新生成。

隔离沿用 [withIdentity](../server/db.ts)、应用角色 `aigc_api`、原成员状态与用户/环境 RLS。环境由运行配置决定，不接收客户端自选 scope。管理角色读取成功不能代替实际应用角色验证。[Supabase RLS 官方说明](https://supabase.com/docs/guides/database/postgres/row-level-security)

## 5. 脱敏样例与退出结论

以下数字仅为模拟测试金额，不代表正式价格。表中返回金额只在模拟源已证实收口时给出；来源与身份规则适用于所有样例。

| 编号 | 原事实 | 期望执行/积分/结果 | 期望展示与操作 |
| --- | --- | --- | --- |
| S01 排队 | 图片 queued，4 项 pending，预留 24 | queued / reserved / pending；已扣与退回均未确认 | 黄灯“排队中 0/4”；仅查询与查看 |
| S02 处理中 | 图片 processing，1 项已保存、3 项处理中 | processing / reserved / available；partial=false | 黄灯“处理中 1/4”；可看已有结果，不判部分终态 |
| S03 全部成功 | 图片 succeeded，4 项已保存，settled，实际扣 24 | succeeded / settled / available；退回 0 | 绿灯“已完成 4/4”；查看/下载，不发生成请求 |
| S04 部分成功 | 图片 succeeded，2 项保存、2 项失败，settled，扣 12/退 12 | succeeded / settled / available；partial=true | 绿灯＋提示“部分完成 2/4”；显示真实扣费差额 |
| S05 普通失败 | 图片 failed，全部失败，released，退回 24 | failed / refunded / unavailable | 红灯“失败”；已退 24；用户准备输入后可手动新建 |
| S06 已超时 | 图片 expired，released，退回 24，TASK_TIMEOUT | expired / refunded / unavailable | 红灯“已超时”；不经旧 failed 映射丢失超时含义 |
| S07 免费抠图 | 同步 bg-remove settled，预留/实际扣分 0，有原 PNG 描述 | succeeded / settled / available | 绿灯“已完成”；免费；可查询且不显示扣 1 分 |
| S08 结果过期 | 原同步 settled、扣 5，有明确对象期限已过证据 | succeeded / settled / expired | 原成功/扣费不变，加“结果已过期”；优先本机已保存素材 |
| S09 提交待确认 | 本地有原 requestId，无已确认服务器任务 | 无服务端 state；clientState=submission_unknown | 灰色“提交结果待确认”；查原请求，禁止自动 POST |
| S10 来源缺失 | 旧 variation succeeded，有结果，无 origin | succeeded / 原账本状态 / available；origin=null | 绿灯“裂变已完成”；先详情，不猜画布项目 |
| S11 免费失败 | 同步 bg-remove refunded，预留 0，普通错误 | failed / refunded / unavailable；退回 0 | 红灯“失败”；未扣积分，不显示正数退款 |
| S12 终态待核对 | 防御样例：failed，但原积分仍 reserved | failed / reserved / unavailable；实际收费/退回为 null | 红灯＋“积分等待结算”；不能提前声称已退款 |

下面提供完整目标摘要和独立的待确认凭据样例，供后续类型/适配器测试使用。对象有效期未实证时为 null；不以签名有效期补填。

```json
{
  "sourceKind": "image_job",
  "sourceId": "00000000-0000-4000-8000-000000000301",
  "taskKey": "image_job:00000000-0000-4000-8000-000000000301",
  "requestId": "00000000-0000-4000-8000-000000000201",
  "tool": "variation",
  "capability": "variation",
  "modelProfileId": "fixture-model",
  "state": "succeeded",
  "requestedCount": 4,
  "completedCount": 2,
  "partial": true,
  "errorCode": null,
  "warnings": ["PARTIAL"],
  "billingState": "settled",
  "creditsReserved": 24,
  "creditsCharged": 12,
  "creditsReturned": 12,
  "resultAvailability": "available",
  "resultExpiresAt": null,
  "origin": { "entry": "workstation", "tool": "variation" },
  "createdAt": "2026-10-11T10:00:00.000Z",
  "updatedAt": "2026-10-11T10:01:00.000Z",
  "completedAt": "2026-10-11T10:01:00.000Z",
  "taskExpiresAt": "2026-11-10T10:00:00.000Z",
  "outcomeVersion": "fixture-terminal-version",
  "seen": false,
  "dismissed": false
}
```

```json
{
  "clientState": "submission_unknown",
  "serverTask": null,
  "receipt": {
    "owner": "00000000-0000-4000-8000-000000000001",
    "scope": "local",
    "sourceKind": "sync_credit",
    "requestId": "00000000-0000-4000-8000-000000000202",
    "origin": { "entry": "workstation", "tool": "remove" },
    "createdAt": "2026-10-11T10:00:00.000Z"
  }
}
```

阶段 1 已确定任务源、身份、三维状态、来源、只读接口职责、恢复策略与有效期证据边界。现有相关测试通过，两个提交/租约风险已在内存推进器复现，详见故障文档。阶段 1 当时把生产对象生命周期、关闭浏览器后的新图片维护、真实供应商对账和新 UI 列为后续。其中关闭浏览器后的图片维护已在 2026-10-12 于生产开启，并完成一笔 Qwen Image 3.0 关页验收，见[阶段 2 说明](task-center-stage-two.md#6-生产分钟维护2026-10-12)。生产对象生命周期、上游账单对账和新 UI 仍待后续。
