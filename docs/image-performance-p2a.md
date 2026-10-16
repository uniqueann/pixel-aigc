# P2-A：预览网络与存储区域对照

## 范围

当前业务 API 共用 `api/entry.ts`，正式配置为 `pdx1`。本批用相同提交的独立单区域 Preview 部署，比较 `pdx1`、`hkg1`、`sin1` 的基础路径；不修改正式域名、生产区域、模型、轮询频率、分辨率或账本。

基础探测不提交生成或商品识别请求，不创建任务、不预扣积分。对象存储请求、读写流量、函数和数据库访问仍占用云服务用量。真实抠图、智能编辑、融合及浏览器直传对照需要另列样本和费用预算。基础探测不能代替完整工具验收或 4 秒指标；后续已完成的用户验收与决策见文末及 [P2 验收与结项](image-performance-p2-acceptance.md)。

## 入口与场景

`POST /api/internal/image-benchmark` 复用实际业务入口和依赖版本。必须同时满足：

- `VERCEL_ENV=preview`、`AIGC_RUNTIME_SCOPE=preview`、`IMAGE_BENCHMARK_ENABLED=true`。
- 有效期未到，且不超过未来 24 小时；使用服务端专用 Bearer 令牌。
- 绑定已确认的预览测试账号和完整 Git 提交 SHA。

正式环境始终返回 404。有效入口依旧受原 Vercel 部署保护约束。请求只允许 `runId`、枚举场景和轮次，不接收 URL、SQL、对象键或供应商任务号。每个请求只执行一个固定场景，不在函数内部循环整批测试。

| 场景 | 实际操作 | 边界 |
|---|---|---|
| `control` | 返回部署、实际区域、提交、配置指纹和进程标识 | 不访问依赖 |
| `database` | 业务连接池、只读事务、`aigc_api` 身份与 preview 范围查询 | 不创建账号、任务或账本；连接池获取与 BEGIN 合计单列 |
| `storage-small` | 固定 512 KiB 字节的 PUT、GET、SHA-256 校验、DELETE | 只删除本轮专用随机对象 |
| `storage-large` | 同上，固定 5 MiB | 不代表图片编码或浏览器上传 |
| `qwen-connect` | 到已配置百炼入口的新连接 DNS、TCP、TLS | 不发送 HTTP 生成请求，不代表模型或状态 API 耗时 |
| `tencent-connect` | 到已配置腾讯 COS 桶入口的新连接 DNS、TCP、TLS | 不调用商品识别，不代表识别处理时间 |

PUT 响应失败时仍尝试清理本次随机对象；清理失败会使样本失败。对象前缀为 `temporary/image-benchmark/<账号>/preview/<运行>/<区域>/`，进程中止时可根据运行编号核对该前缀残留，不允许扫描或删除其他对象。

配置一致性用本轮令牌作为 HMAC 密钥，比较数据库、存储、入口及主要轮询配置；不输出凭证、桶名、对象键或私有 URL。实例编号与调用次序不能证明平台冷启动；预览冷启动也不等同生产。

## 执行

从最新 main 新建分支，完成检查并提交代码后部署。Hobby 每个部署只选一个区域，构建依次执行。每个部署使用相同 runtime 覆盖值：

```text
IMAGE_BENCHMARK_ENABLED=true
AIGC_RUNTIME_SCOPE=preview
IMAGE_BENCHMARK_TOKEN=<本轮随机私钥，至少 32 字符>
IMAGE_BENCHMARK_USER_ID=<已有 active 测试账号 UUID>
IMAGE_BENCHMARK_REVISION=<被部署的 40 位提交 SHA>
IMAGE_BENCHMARK_EXPIRES_AT=<不超过未来 24 小时的毫秒时间戳>
```

优先使用本次部署的环境覆盖，避免修改项目生产环境变量。不要将私钥放进 Git、浏览器或测试清单。原有 Preview 数据库和存储变量直接由 Vercel 注入；Secret 拉取时可能只有占位值，不能用占位值覆盖部署环境。

清单示例（保存在私有临时目录，替换提交和三个独立部署地址）：

```json
{
  "version": 1,
  "runId": "00000000-0000-4000-8000-000000000001",
  "revision": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "rounds": 20,
  "maxRequests": 400,
  "maxTransferMiB": 1024,
  "cases": ["control", "database", "storage-small", "storage-large", "qwen-connect", "tencent-connect"],
  "targets": [
    { "region": "pdx1", "url": "https://deployment-pdx.vercel.app" },
    { "region": "hkg1", "url": "https://deployment-hkg.vercel.app" },
    { "region": "sin1", "url": "https://deployment-sin.vercel.app" }
  ]
}
```

先预估（默认不发请求、不创建结果文件）：

```sh
npm run benchmark:image-network -- --manifest /私有目录/manifest.json --output /私有目录/results.jsonl
```

执行时通过进程环境注入本轮 `IMAGE_BENCHMARK_TOKEN`。受保护部署优先使用已登录的 Vercel CLI，设置 `VERCEL_CLI_ENTRYPOINT` 为其 JavaScript 入口绝对路径：

```sh
npm run benchmark:image-network -- --manifest /私有目录/manifest.json --output /私有目录/results.jsonl --execute --via-vercel
npm run benchmark:image-network -- --manifest /私有目录/manifest.json --output /私有目录/results.jsonl --execute --via-vercel --resume
npm run benchmark:image-network -- --manifest /私有目录/manifest.json --output /私有目录/results.jsonl --report-only --via-vercel
```

不需要 Vercel CLI 的已授权 HTTP 环境可省略 `--via-vercel`；可从进程环境读取短时 `VERCEL_OIDC_TOKEN`，发送到清单中的本项目预览部署以通过 Trusted Sources。已有自动化保护密钥也支持从进程环境读取。CLI 模式的 `requestMs` 包含进程及认证开销，区域分析优先比较服务端分段，不将它当作用户浏览器的端到端耗时。

本机解析或路由导致某些预览域名连接中断时，可使用 `--via-curl`，并在私有清单中显式设置 `controlEdgeAddress` 为已核实的共同连接入口 IPv4 地址。curl 配置和凭证通过标准输入传递，保留每个部署的原域名、SNI 和证书校验；这类数据只分析函数内部路径，不评价用户端 DNS 或端到端网络。传输方式与地址均绑定清单指纹，恢复时不能混用。

也可给本轮部署分配独立的 Vercel 预览别名。使用别名时，在对应 target 增加 `deployment` 字段填写原始部署主机名，仍核对返回的实际部署、区域和提交；测试别名不绑定正式域名，也不替代原部署身份校验。

每场景每区先做一轮预热，随后 20 轮正式采样，单并发交错区域并轮换先后。完整清单共 378 次请求，对象 PUT/GET 预算 693 MiB；无模型调用、无站内积分。预算在执行前和每次请求前校验，失败请求也占计划预算。

每次请求发出前持久化尝试记录。断点恢复绑定相同清单，跳过已完成样本；若中断留下回执未知的请求，拒绝自动重发，可先生成不完整报告再决定新一轮。配置、提交、实际区域或部署地址不匹配时立即停止；相同场景连续三次失败或未配置也停止，保留已完成数据。

## 验收与后续决策

原始 JSONL 和自动生成 Markdown 保存到指定私有路径。报告按区域及场景展示预期与已收样本、失败、跳过、p50、p95、分段及样本数；首轮预热不计入分位数，失败不能混入成功时延或从总样本中消失。

P2-A 基础批次通过要求：真实区域与预期一致、代码和依赖配置一致、测试可复现、只读数据库与专用存储边界通过、清理状态明确、能判断主要网络差异。小样本和同一时段的结果仅支持初步筛选；分时段复测后，再选一个候选区域与 pdx1 做完整工具对照。

候选完整流程建议以中位数改善至少 15% 且至少 1 秒作为迁移筛选线，并观察尾延迟、失败率、图片质量及账本。该筛选线不是本批承诺收益，也不替代生产验收。若只有部分工具受益，应先评估独立函数边界；当前改全局区域会影响其他 API。

## 初次部署与预检记录

2026-10-16 已从 #188 合并后的 `bf97aa7` 新建分支，部署探测提交 `c20d1cfa312bd7a8d86d2bafcb15fd612105be58`。三个独立 Preview 均为 READY，平台部署记录与各自 `control` 响应均确认实际区域为 `pdx1`、`hkg1`、`sin1`。三个响应的代码、配置指纹和 Node.js 版本一致；内存值未观测到，不能据此宣称运行内存已核实。

`pdx1` 的一次数据库预检成功，只证明预览账号、业务连接池和只读查询可用，不作为区域性能样本。当时控制端到 Preview 域名的 TLS 连接反复中断，正式批次没有形成有效区域对照；R2 读写、清理及供应商连接的云端采样尚未完成。保留失败批次及缺失样本，不自动重发回执未知的请求，不据此推荐迁移区域。

本批未调用模型、未扣站内积分。预览测试账号的任务数 `29`、积分流水数 `72`、调用记录数 `14` 在探测前后均一致。未改变正式站区域及业务参数，旧转存回执未回填。脱敏证据见 [预览部署与基线记录](verification/image-performance-p2a/preview-baseline.json)；私有原始记录保留在本机临时目录，专用入口到期自动关闭。

本地验证已通过：272 个测试文件、1805 项测试，无未处理错误；构建、lint 和差异格式检查通过。这是初次交付记录，后续验收没有覆盖或改写该批原始证据。

## 后续验收与区域决策

用户后续完成三个区域的 72 次基础请求，报告全部成功，实际区域和提交 `349bf28` 均符合预期；每项仅测 5 次且处于同一时段。业务只读查询在美西约 33ms、香港约 1.6 秒、新加坡约 1.9 秒；千问新连接以新加坡约 0.18 秒最快，腾讯新连接以香港约 0.19 秒最快。数据库探测的 `query` 段包含会员与任务列表两次 SQL 查询；供应商连接数据仅代表 DNS/TCP/TLS，不代表生成或识别处理耗时。

基于这批用户提供的数据，生产区域继续使用 `pdx1`。当前整体迁到亚洲会引入明显的数据库访问成本；仅将供应商 I/O 拆成亚洲独立函数保留为候选，不作为本轮实施项。用户没有在汇总中提供 R2 分区读写与清理的逐条数据，因此不补写相关分位数或完整存储验收结论。

用户还完成 10 次真实工具测试并拆分日志：9 次成功、1 次融合上游 `InternalError.Algo` 失败后退款，预扣 26、退回 3、净扣 23 积分，无重复扣费。这批结果和后续 P2-B 真实复测结论共同记录在 [P2 验收与结项](image-performance-p2-acceptance.md)。这些是用户提供的验收报告；本机未读取其位于 `/workspace/workstation-test/shared-results/pr189/fulltool/` 的原始文件。
