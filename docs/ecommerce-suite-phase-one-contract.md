# 电商套图阶段一：冻结契约

| 项目 | 内容 |
| --- | --- |
| 基线 | 2026-10-17，`main` / `55e6040`，PR #193 已合并 |
| 契约版本 | `SUITE_CONTRACT_VERSION = 1`，模板 `home-kitchen-v1` |
| 范围 | 共享 Schema、类目模板、请求和读模型、交互与异常行为、数据库设计及验收基线 |
| 运行状态 | 新增契约尚未接入路由、生成服务或任务中心；数据库迁移与真实服务在后续阶段实现 |
| 关联 | [总计划](ecommerce-suite-development-plan.md)、[数据库设计](ecommerce-suite-database-contract.md)、[故障矩阵](ecommerce-suite-failure-matrix.md)、[证据与样本](verification/ecommerce-suite/phase-one/README.md) |

## 1. 规范定义与边界

[shared/ecommerce-suite.ts](../shared/ecommerce-suite.ts) 是参数、读模型和限制的唯一规范定义；类型由 Zod 推导，不再手工维护一份不相容的前端接口。三个子类、推荐风格与七槽位处理策略在[模板配置](../shared/ecommerce-suite-templates.ts)中。

Schema 验证结构与局部一致性，不能代替登录鉴权、RLS、资产归属、模型实时目录、报价是否过期或真实账本查询。未来服务必须验证请求上下文；合同样例通过不等于 API 或数据库已经实现。

### 1.1 字段与身份冻结

- UUID 用于项目、槽位、资产、版本、报价、批次、操作、桥接和幂等请求；槽位 `key` 与 `kind`、展示 `order` 分开。序号变化不改变主图保护与结果归属。
- 写入只接收 `config` 及显式的乐观锁／请求身份；`actor`、对象路径、当前指针、原任务、费用与执行状态来自服务端。读模型为 `{ id, actor, revision, config, slotHeads, ...时间字段 }`。
- `config.slots` 始终七项，跳过采用 `enabled: false`；ID、模板 key、order 各自唯一。Amazon 美国站主图不能关闭；通用模板不接收 `marketplace`。
- `revision` 只跟随项目配置更新；`headRevision` 只保护当前版本切换；`draftRevision` 只跟随单槽位编辑草稿更新。后台进度、通知已读与焦点变化不能推动这些修订。
- 临时签名、上传许可、访问令牌不写入项目或恢复包；资产记录保存持久对象键、真实宽高、大小与校验值。
- `SuiteSlotVersion` 的读模型使用 `composition` 封装画板、图层、已确认事实、语言／单位、模板及渲染器版本；相同底图可以拥有不同成品版本。

### 1.2 固定限制与动态限制

| 项目 | 冻结行为 |
| --- | --- |
| 标签 | 最多 30 个，每个 80 字；去首尾空白后拒绝重复 |
| 事实 | 最多 50 个，UUID 唯一；尺寸使用测量对象 `subject`（默认 product）和 `axis`，仅禁止同一对象同方向冲突，整体与部件可分别记录 |
| 规格 | 尺寸、容量、重量、承重分别限制数值与单位，必须有限正数；材质／功能为文字 |
| 图层 | 每槽位 20 层、单文本 200 字；空文字可存草稿，成品必须非空 |
| 坐标 | 以成品画板为参照的 0～1 坐标；宽度大于零；标注线不可退化成一点 |
| 图片上传 | 静态 JPEG／PNG／WebP，最多 20 MiB；服务端仍需解码核验，不接受 SVG |
| 报价 | 接收有效期 10 分钟；同一槽位不能重复报价，明细费用和合计须一致 |
| 批次 | 首次派发窗口 30 分钟，接收时冻结总预算；不新增父批次收费 |
| 回填／回收站 | 会话及软删除宽限期均为 7 天，保留原任务独立生命周期 |
| 模型 | 1～4 是绝对数量上限，真实数量、分辨率、比例、参考图数和价格仍取服务端目录 |
| 字体 | 首期字体身份为 `Noto Sans SC`、`Noto Sans`；字体文件、许可归档和统一测量在阶段四验收，当前未安装字体资产 |

## 2. 类目与槽位策略

三个子类均包含稳定 key：`main / scene / secondary / feature / size / detail / use`。同一 key 的名称和语义可因子类而不同，例如厨房 `secondary` 是材质／结构说明，并非家具的夜间氛围。

模板策略有三类：`reuse` 复用持久资产与确定性排版；`image_edit` 复用原图片服务；`detail_reference` 要求用户提供真实细节图，再选择复用或现有精修。最后一类在报价时必须解析为具体路径，不能作为隐含收费能力提交。

阶段二计划服务必须对照模板重新计算策略，不能信任客户端的 `mode`。主图与尺寸默认只走复用，主动 AI 编辑经工作站单独确认；没有细节参考不能编造内部结构。卖点／尺寸输入缺失时标明待补资料或允许跳过辅助槽位。

风格标签仅为建议，不自动变成事实。解析“长 210cm 宽 85cm”时保存 `length=210cm`、`width=85cm`；未知方向、冲突与无法解析内容留在原标签。`confirmed: false` 可以存项目，不能进入生成或成品快照；确认操作由用户表单明确触发。

## 3. 页面操作契约

附件和主题映射沿用[总计划第二节](ecommerce-suite-development-plan.md)。缺失的列表、向导、回填及导出页面按下表实现。

| 操作 | 前置与状态来源 | 保存及收费 | 失败处理 |
| --- | --- | --- | --- |
| 新建 | 已登录用户，名称、主体资产、平台／子类可用 | 幂等创建配置，七槽位由模板校验，不开始生成 | 留在向导保留输入；响应丢失查原请求 |
| 打开／复制配置 | 当前账号环境有访问权限 | 打开读项目；复制仅复制经校验配置与资产授权关系 | 复制不继承任务、报价、当前版本或执行权限 |
| 保存配置 | 携带 `expectedRevision` | 800ms 防抖，提交／离开关键路径前刷新保存 | 409 保留本机副本，选读取云端或另存，不覆盖 |
| 切槽位／页签 | 当前草稿已落本机，远端可异步保存 | 每槽位独立草稿；不创建任务 | 保存失败保留编辑并显示未同步 |
| 请求报价 | 配置已保存，资产、事实及模板前置资料有效 | 服务端目录规范化规格并持久保存只读报价，无预扣 | 返回明确缺项／模型错误，不能当免费 |
| 首次／整体／单槽位生成 | 确认报价、范围、候选、费用及派发期限 | 只创建持久操作；派发由原任务事务预扣 | 响应不明先查原批次，不换请求号重提 |
| 手动重试 | 原项明确失败或未执行；没有待确认的旧任务 | 新尝试重新报价与确认，成功项排除 | 停止旧未派发项并使租约失效；不重提未知项 |
| 停止批次 | 可读当前批次 | 仅停止未建原任务的项，不影响已成功成品 | 已提交项继续结算，不能承诺免除其费用 |
| 改文字／尺寸 | 已有可读底图；主图规则允许；数值事实已确认 | 先保存草稿，显式保存／导出前形成图层版本，不调用模型 | 草稿可保留临时空文字，成品保存显示缺项 |
| 设为当前 | 版本属于同项目同槽位且资产可读 | `expectedHeadRevision` 更新指针，恢复完整快照，不扣费 | 保留脏草稿；冲突只新增候选，不静默覆盖 |
| 工作站编辑／回填 | 保存来源版本后创建会话，URL 只传 `bridgeId` | 原工具独立计费；显式回填幂等新增版本 | 账号变化拒绝；来源过时仅存候选；原结果仍可下载 |
| 平台预检 | 冻结版本与导出配置 | 规则／元数据检查免费，输出依据与未知项 | 确定失败阻止对应文件；未知项不能标绿通过 |
| 导出 | 先保存并冻结版本、配置与图层 | 浏览器统一合成，逐张编码，普通导出不收费 | 只重试读取或编码，可确认仅导出成功项 |
| 删除／恢复 | 有权限且在七天期限内 | 停止未派发项，保留原任务与账本 | 到期仅删无引用资产，不能级联删账本 |

窄屏在 900px 及以下上下布局，短屏吸底栏可回退普通流。没有可信进度不展示百分比；只有已验证持久队列才能承诺整套关页继续。旧成品与新尝试状态分别展示。

## 4. API 输入与响应

以下目标路径统一以 `/api` 为前缀。创建成功返回 201，读取和写入成功返回 200，批次已接收返回 202。原请求重放返回原对象；重放的状态码可为 200，但 ID、费用与原归属不变。接口尚未注册。

| 方法与路径 | 输入规范 | 响应与行为 |
| --- | --- | --- |
| `GET /ecommerce/suites` | `limit=1..50`、不透明 `cursor`、可选平台／派生状态 | `{ items: 摘要[], nextCursor }`，不加载全部历史 |
| `POST /ecommerce/suites` | `suiteCreateProjectRequestSchema` | `{ project: SuiteProject }`；同请求号不同配置 409 |
| `GET /ecommerce/suites/by-request/:requestId` | 当前身份＋原创建请求号 | 原项目或 404，纯查找，不自动创建 |
| `GET /ecommerce/suites/:id` | UUID，当前身份 | `{ project }`，指针只属于本项目 |
| `PATCH /ecommerce/suites/:id` | `suiteUpdateProjectRequestSchema` | `{ project }`；版本冲突 409 |
| `POST /ecommerce/suites/:id/assets` | `suiteUploadRequestSchema` | `{ assetId, uploadId, uploadUrl, expiresAt }`；不直接接受对象键 |
| `POST /ecommerce/suites/:id/assets/complete` | `suiteUploadCompleteRequestSchema` | `{ asset: SuiteAssetRef }`；校验字节并提升到持久命名空间 |
| `POST /ecommerce/suites/:id/assets/import` | `{ requestId, sourceAssetId }`，均为 UUID | 校验原资产权限，建立当前项目引用；不能凭 ID 获得权限 |
| `POST /ecommerce/suites/:id/assets/access` | `suiteAssetAccessRequestSchema` | `{ items: [{ assetId, url, expiresAt }] }`；不返回他人对象 |
| `PATCH /ecommerce/suites/:id/slots/:slotId/draft` | `suiteSaveDraftRequestSchema` | `{ draft, draftRevision }`；空文字允许，不能携带任务状态 |
| `POST /ecommerce/suites/:id/quotes` | `suiteQuoteRequestSchema` | `{ quote: SuiteQuote }`；规范化后保存十分钟报价，不预扣 |
| `POST /ecommerce/suites/:id/batches` | `suiteCreateBatchRequestSchema` | `{ batch, operations }`；从归属正确的报价读取计划，客户端不提交报价明细 |
| `GET /ecommerce/suites/:id/batches/by-request/:requestId` | 原批次请求号 | 原批次和操作；404／未知不能授权重放收费请求 |
| `GET /ecommerce/suites/:id/batches/:batchId` | 同项目归属 | 批次、阶段、原结果与账本聚合，只读 |
| `POST /ecommerce/suites/:id/batches/:batchId/stop` | 空对象 | 当前批次和已停止项，不取消上游已接收任务 |
| `GET /ecommerce/suites/:id/slots/:slotId/versions` | 分页游标、limit | `{ items: SuiteSlotVersion[], nextCursor }`；短期 URL 另取 |
| `POST /ecommerce/suites/:id/slots/:slotId/versions` | `suiteSaveVersionRequestSchema` | `{ version }`；服务端验证基准资产及已确认事实，不接受伪造来源 |
| `PATCH /ecommerce/suites/:id/slots/:slotId/current` | `suiteSetCurrentRequestSchema` | `{ slotId, activeVersionId, headRevision }` |
| `POST /ecommerce/suites/:id/bridges` | `suiteCreateBridgeRequestSchema` | `{ bridgeId, expiresAt, destination }`；来源归属与修订校验 |
| `GET /ecommerce/bridges/:bridgeId` | 当前账号环境 | 来源身份、短期可读输入和真实工具，不泄露令牌 |
| `POST /ecommerce/bridges/:bridgeId/results` | `suiteBridgeResultRequestSchema` | `{ version, activated: false }`；仅追加，用户选择当前 |
| `POST /ecommerce/suites/:id/prechecks` | `suitePrecheckRequestSchema` | `{ ruleProfile, checks, checkedVersionIds }`，四态结果及依据 |
| `DELETE /ecommerce/suites/:id` / `POST .../:id/restore` | 删除带 `expectedRevision`，恢复空对象 | `{ project }`；关联任务及账本不删除 |

列表和版本游标绑定账号、环境、筛选、稳定排序时间与 ID，不接受客户端 offset 冒充跨环境游标。所有入口在阶段二或对应后续阶段实现时同时接入 Schema 与服务端上下文校验。

## 5. 状态、报价与计费

### 5.1 派发状态

操作 `waiting` → `dispatching`（领取租约）→ `bound`（原任务创建、预扣及绑定同事务）→ 原任务终态／结果入库。无法确认原创建结果进入 `confirming`，只能原请求查找；确定未建原任务的限流可回到 `waiting` 并使用服务端退避。余额／目录变化进入 `blocked`，未执行取消进入 `stopped`。

原任务有明确终态后记录只读的终态／结果关联快照，供原任务过期后继续展示；账本仍查原账本。已有任务 ID、提交凭证或终态的操作不能因 404 退回首次派发。待选用候选不算活动任务。

批次优先判断活动原任务／领取中为 `running`，否则待解决阻塞为 `blocked`，待首次派发为 `queued`。全部收口后：全部成功登记为 `succeeded`，有成功且有失败／停止为 `partial`，全失败为 `failed`，无成功且全停止为 `stopped`。已绑定原任务不能被批次停止改写成取消。

### 5.2 报价接受

- 新增 `suite_quotes` 保存不可变计划及归属，避免接受客户端伪造的收费明细；这是对总计划七张表草案的必要补齐，详见数据库契约。
- 接受时重新验证项目修订、报价归属、十分钟有效期、计划指纹及 `maxCredits >= totalCredits`；同一报价只能关联一个批次，重复原请求返回原批次。
- 总余额检查不锁定整批金额，每个原任务按实际目录再次验证后独立预扣；价格或模型变化阻塞后续派发，不能默默涨价或换模型。
- 四张都成功即按四张收费，最终选一张不改账单；局部成功、退款、超时晚到沿用原账本。父批次不设收费状态，原账本未知时保留未知。
- 回填、图层保存、版本切换和导出不预扣；登记失败仅修复原结果，不调用生成。

### 5.3 任务中心

阶段一的 `suiteOriginSchema` 只是后续适配契约，当前 `taskOriginSchema` 仍拒绝它，现有 `taskTools / taskSourceKinds` 不变。阶段三再接入 `suite_batch` 摘要、来源验证、游标／UI 约束及返回路由，父子不重复计活动数量或费用；工作站任务保持原工具来源。

## 6. 版本、草稿与回填不变量

- 版本不可变，尺寸只读本版本 `factsSnapshot`，不读当前项目事实；图层编辑经 `parentVersionId` 保留来源，不伪造新任务。
- 编辑草稿可保留不完整文本，成品 Schema 拒绝空文字、未确认数值、越界坐标和无效引用。服务端额外核对事实与项目确认记录一致。
- 首次单候选仅在无成品、无脏草稿且 `headRevision` 未变时可自动激活；所有重生成、回填和来源过时结果默认候选。
- 桥接输入默认为无文字底图，合成图需明确选择；重复同结果返回同版本，不同候选可分别追加。会话本身不授权生成或支付。
- 导出冻结当前已保存版本清单；平台预检检查配置，最终编码后的格式／像素再检，不把选项当文件证据。

## 7. 错误与恢复动作

响应沿用现有网关 `{ error: 中文提示, code, requestId, ...受控扩展 }`，不引入第二种错误外壳。

| HTTP／错误码 | 前端动作 |
| --- | --- |
| 400 `INVALID_REQUEST` / `SUITE_FACTS_REQUIRED` | 修正资料；不能进入扣费流程 |
| 401 `ACCOUNT_CHANGED`／认证失效 | 中止旧操作，当前账号重新读取，不迁移旧缓存 |
| 404 `SUITE_NOT_FOUND` | 项目不存在或无权限统一提示；不能自动新建 |
| 409 `SUITE_REVISION_CONFLICT` / `SUITE_HEAD_CONFLICT` | 保留本机修改，读取云端或显式另存 |
| 409 `SUITE_REQUEST_CONFLICT` / `SUITE_BATCH_ACTIVE` | 定位原请求／活动批次，不循环提交 |
| 409 `SUITE_QUOTE_CHANGED` / `SUITE_RESULT_CONFLICT` | 重新确认或保留候选，不自动替换 |
| 410 `SUITE_QUOTE_EXPIRED` / `SUITE_BRIDGE_EXPIRED` / `TASK_EXPIRED` | 重新报价／重建会话／查看已有成品，不重做原生成 |
| 402 `INSUFFICIENT_CREDITS` | 明示已发生费用，待用户处理并确认未执行项 |
| 429 `RATE_LIMIT` 与原并发错误 | 仅确定未创建的首次派发可按退避等待；未知任务只读查找 |
| 503 `SUITE_ASSET_UNAVAILABLE` | 重新授权读取或修复登记；区分对象暂不可读与真实不存在 |

## 8. 阶段一出口

共享 Schema、三个模板、全部操作的输入输出、状态／费用语义、数据库约束与验收 ID 已落文件并可本地校验。代码未开放运行入口，RLS／并发／HTTP／真实模型验证仍属于后续实现的门槛。

九个真实商品样本的采集位置、规格和质量检查已列清单，当前收到 0 个真实商品素材；合同样例全部明确为合成身份。该真实样本采集项保持待完成，不将其标记为真实商品或供应商验收通过。

阶段五实现补充：`POST /ecommerce/suites/:id/prechecks` 保留上述请求及 `ruleProfile / checks / checkedVersionIds`，同时返回冻结版本、资产、逐文件证据、输出配置、规则复核日期、检查时间和指纹。下载前重新核对指纹，实际编码后再检查文件；详见[阶段五说明](ecommerce-suite-phase-five.md)。
