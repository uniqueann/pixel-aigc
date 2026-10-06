# 千问图像 3.0 / 3.0 Pro 文生图（P0）

更新时间：2026-10-06。

P0 把阿里云百炼 `qwen-image-3.0` 和 `qwen-image-3.0-pro` 接进现有图片任务层。默认关闭。关闭时模型列表、能力开关和 GPT Image 2 的提交方式都不变。

官方接口说明：

- API 参考：https://help.aliyun.com/zh/model-studio/qwen-image-generation-and-editing-api-reference
- 模型页：https://help.aliyun.com/zh/model-studio/qwen-image-3-0 与 https://help.aliyun.com/zh/model-studio/qwen-image-3-0-pro

## 行为

- 使用 DashScope **异步**接口：`POST /api/v1/services/aigc/image-generation/generation`，请求头 `X-DashScope-Async: enable`，再 `GET /api/v1/tasks/{task_id}`。每次提交和查询都是短请求，不在一个函数里等到出图。
- 一次请求的 `n` 等于用户要的张数（1–4）。`image_jobs.requested_count` 现有检查也是 1–4，所以没有把官方上限 6 暴露出来。成功后仍按实际返回张数结算；少返回的序号记失败并退回对应积分。
- GPT Image 2 继续按张扇出，`n` 仍是 1。任务层的超时、轮询间隔和并发改从供应商的 `jobPolicy()` 读取。
- 成功图片下载后写入 R2。同一任务的多张图并行下载（最多 4 张同时），供应商 URL 24 小时失效，不能拿来长期展示。
- 上游不回传金额。成功后按模型目录单价乘以实际返回张数写入 `provider_params.vendor.cost`，并带 `currency: CNY`。公开的模型接口和任务接口都不返回 `vendorCost`。DashScope 没有 `credits_cost`，该字段保持 0；用户积分仍在 `credits_charged`。
- 状态日志 `qwen-image-status` 和用量日志 `bailian-usage` 带上 `submitTime` / `scheduledTime` / `endTime`（来自任务结果）以及 `imageShape`（多图解析命中了哪一段）。`bailian-usage` 和 `qwen-image-submit` 还带上实际采用的 `enableThinking`。
- 思考默认关闭。自由画布在选中千问模型时显示「自动扩写」，勾选后当次请求带 `enableThinking: true`。积分与关闭时相同。`prompt_extend` 仍只由环境变量控制，默认 `true`。
- 浏览器对 `bailian:` 任务大约每 1 秒问一次本服务；GPT Image 2 仍是 2 秒，视频仍是 5 秒。服务端对千问仍按 `QWEN_IMAGE_POLL_INTERVAL_MS`（默认 3 秒，且不低于 3 秒）才去 `GET /tasks`。提交收尾不再把首次查询时间改成稳态间隔。
- 千问使用自己的 undici 连接，建连超时默认 10 秒（`QWEN_IMAGE_CONNECT_TIMEOUT_MS`）。消除、重绘、扩图继续用 `server/dashscope.ts` 的 4 秒。连接失败日志带 `errorCode` 和 `cause`（例如 `UND_ERR_CONNECT_TIMEOUT`）。只有能确定请求字节还没写出的失败（建连超时、DNS、连接被拒绝）才把明细留在 pending，并在截止时间前的下一轮轮询再提交；同一次提交里这种重试最多一次，避免和 30 秒租约重叠后再发一单。`ECONNRESET`、裸 `fetch failed`、读超时都直接失败，因为上游可能已经收到请求。
- 提交遇到瞬时限流（HTTP 429，`Throttling` / `Throttling.RateQuota` / `Throttling.BurstRate`）不再在这次请求里重试，也不把任务判失败。明细保持 pending，任务状态保持 `queued`，界面显示「排队中」。下次提交按退避时间排队：3.0 从 8 秒起，Pro 从 15 秒起，每次翻倍，封顶 60 秒，再加 0–50% 抖动。截止前由用户轮询触发重提；已经有 `task_id` 的明细不会再提交。`qwen-image-submit` 日志带上游 `upstreamCode`（例如 `Throttling.RateQuota`）。
- 一直限流到截止时间：全额退回预扣，错误文案是「当前排队人数较多，请稍后重试（积分已退回）」。已经向上游提交成功、只是生成超时的任务仍用「任务处理超时，请重试」。
- `Throttling.AllocationQuota`（以及 “allocated quota exceeded” / “please increase your quota”）视为额度用尽，立即失败并退款，不进入排队。百炼文档里这个码也用于每分钟 Token 配额，通常比 RPM 更慢恢复；300 秒截止内不把它当瞬时限流重试。
- 创建千问任务时，在预扣积分之前检查并发：全部百炼文生图进行中不超过 `QWEN_IMAGE_ACTIVE_LIMIT`（默认 8），其中 Pro 不超过 `QWEN_IMAGE_PRO_ACTIVE_LIMIT`（默认 4）。超出返回 429，文案「当前排队人数较多，请稍后重试」，此时没有预扣。计数按环境、跨用户，和现有全局 20 个进行中任务一起生效。GPT Image 2 不读这两项。
- 两个模型的 `enabled` 在注册表里保持 `false`，积分说明和本地 Mock 模型列表因此不会出现它们。服务端只在开关打开且 Key 可用时把它们放进 `GET /api/image-models`。画布报价读的是这个接口，所以预览里打开开关后，生成面板的预估积分是对的；积分页说明仍只写 GPT Image 2，留给 P1。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `QWEN_IMAGE_ENABLED` | 关闭 | 只有精确的 `true` 才列出模型 |
| `QWEN_IMAGE_API_KEY` | `DASHSCOPE_API_KEY` | 必须和地域、业务空间一致 |
| `QWEN_IMAGE_BASE_URL` | `DASHSCOPE_BASE_URL`，再回退 `https://dashscope.aliyuncs.com` | 只认 https origin。生产建议 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com` |
| `QWEN_IMAGE_MODELS` | 两个都允许 | 逗号分隔。未知 id 忽略。只填 `qwen-image-3.0` 可以不开放 Pro |
| `QWEN_IMAGE_PROMPT_EXTEND` | `true` | `false` 关闭智能扩写。关闭时请求里的 `enable_thinking` 固定为 `false`，画布开关不能绕过 |
| `QWEN_IMAGE_THINKING` | 未设置 | 见下面的优先级。不要把它设成 `false` 还指望画布开关生效 |

### 自动扩写 / `enable_thinking`

Preview 实测（`qwen-image-3.0`，1K，1:1，1 张）：思考打开时端到端 75–120 秒（供应商生成 61–72 秒），关闭时 22–36 秒（供应商生成 17.6 秒）。文字都准确。打开后模型会补上提示词没要求的内容（信息图多出一列参数和一排编造的小字）；关闭时更贴提示词。因此默认关闭。勾选与否不改变积分。

发给 DashScope 的 `enable_thinking` 按这个顺序决定：

1. `QWEN_IMAGE_PROMPT_EXTEND=false`：恒为 `false`。官方接口里思考只在 `prompt_extend=true` 时生效，所以扩写开关保持原样，不改成跟着画布走。
2. `QWEN_IMAGE_THINKING` 为 `true` / `false` / `1` / `0`：运维强制覆盖，忽略当次请求。
3. 变量未设置（空值或其他写法也算未设置）：用请求里的 `enableThinking`。不传或 `false` 都是关闭。

任务创建时把解析后的布尔值写入 `provider_params.enableThinking`，原始请求留在 `params.enableThinking`。提交时用同一套规则再算一次；`qwen-image-submit` 记的是实际发出的值。GPT Image 2 接受这个可选字段，但不写入自己的供应商参数，也不传给 DragonCode。

自由画布只在选中千问模型时显示开关，默认不勾选。选择记在项目草稿里，和「生成声音」一样随项目保存。切回 GPT Image 2 时不发送该字段，草稿里的选择还在。
| `QWEN_IMAGE_TASK_TIMEOUT_MS` | `300000` | 任务截止。超时退款。远小于 task_id 的 24 小时查询窗口 |
| `QWEN_IMAGE_POLL_INTERVAL_MS` | `3000` | 首次之后查询上游的间隔，最小 3000。浏览器问得更勤也不会更频繁打到 DashScope |
| `QWEN_IMAGE_INITIAL_POLL_DELAY_MS` | `3000` | 提交后第一次查询上游前的等待 |
| `QWEN_IMAGE_MAX_PARALLEL` | `1` | 千问走批量 `n`，这个值只在意外扇出时限制并发 |
| `QWEN_IMAGE_REQUEST_TIMEOUT_MS` | `30000` | 单次提交或查询的 HTTP 超时 |
| `QWEN_IMAGE_CONNECT_TIMEOUT_MS` | `10000` | 千问建连超时。不改变消除/重绘/扩图 |
| `QWEN_IMAGE_REQUEST_RETRY_COUNT` | `2` | 5xx 和查询连接失败的请求内重试次数。提交时的建连失败最多再试 1 次。瞬时限流不在请求内重试 |
| `QWEN_IMAGE_ACTIVE_LIMIT` | `8` | 同一环境里进行中的百炼文生图任务。预扣前检查 |
| `QWEN_IMAGE_PRO_ACTIVE_LIMIT` | `4` | 其中 `qwen-image-3.0-pro` 的进行中任务 |
| `QWEN_IMAGE_FORCE_THROTTLE` | 关闭 | 仅预览或本地。`true` / `rate` 让提交假装 `Throttling.RateQuota`；`quota` 假装 `AllocationQuota`。`VERCEL_ENV` 或 `AIGC_RUNTIME_SCOPE` 为 `production` 时忽略；两者都未设置时也不生效 |

模型目录里的建议积分（开关打开后才会真正预扣）：3.0 为 1K/2K 各 3 分；Pro 为 1K 4 分、2K 8 分。`vendorCost` 按北京地域人民币记录，公开接口不返回该字段。

比例使用 1:1、4:3、3:4、16:9、9:16。没有 4K。客户端如果草稿里是 4K，现有逻辑会先降到 2K 再提交；直接传 4K 会被服务端拒绝。

## 在 Vercel Preview 打开

1. 确认 Preview 环境已有可用的北京地域 `DASHSCOPE_API_KEY`（消除/重绘/扩图那把），或者另设 `QWEN_IMAGE_API_KEY`。Key、模型和 `DASHSCOPE_BASE_URL` 必须属于同一地域、同一业务空间。
2. 给 Preview 增加 `QWEN_IMAGE_ENABLED=true`。不要在 Production 打开。如果分支上已经有 `QWEN_IMAGE_THINKING=false`，删掉它。未设置时的默认已经是关闭，留下 `false` 会盖住画布「自动扩写」。
3. 如果已经改用业务空间域名，把 `DASHSCOPE_BASE_URL` 或 `QWEN_IMAGE_BASE_URL` 设成 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，不要带 `/api/v1`。
4. 重新部署该 Preview。
5. 登录后看 `GET /api/image-models?operation=text_to_image`。应返回 GPT Image 2 和两个千问模型，响应里没有 `vendorCost`。不传 `modelProfileId` 的文生图仍走 GPT Image 2。
6. 用一张 1K、数量 1 的描述做冒烟，确认结果进了画布和 R2，而不是停在供应商 URL 上。Pro 建议数量大于 1 时看网络日志，确认只有一次上游提交。
7. 要模拟限流：只在 Preview 设置 `QWEN_IMAGE_FORCE_THROTTLE=true`（或 `quota`），重新部署后再提交一张千问图。`true` 应停在「排队中」且不调用百炼；到截止后失败文案带「积分已退回」。`quota` 应马上失败并退款。测完删掉该变量。Production 即使误设也会被忽略。

## Preview 冒烟（2026-10-06）

开关打开、北京地域 Key、Vercel 区域 Oregon（pdx1）：

- `qwen-image-3.0` 1K 一张、`qwen-image-3.0-pro` 1K 16:9 两张都成功。Pro 只有一次上游提交，`n=2`。
- 尺寸 `1328*1328` 和 `1664*928` 被原样接受，并按 1K 计费（面积都低于 2,250,000）。结果进了 R2。用户积分分别结算 3 和 8。
- 端到端大约 75 秒。其中供应商生成约 61–72 秒，下载加写 R2 约 2–3 秒，服务端完成后到画面可见还有 4–7 秒。浏览器两次查询间隔约 5–6 秒：服务端策略是 3 秒，但当时浏览器固定 2 秒，再加跨太平洋往返，经常踩不中窗口。这次把百炼任务的浏览器间隔收到 1 秒，让实际查询靠近 3 秒，而不是把上游查询改得比 3 秒更密。
- 同一次预览里，20:04:47 和 20:05:05（UTC+8）两次提交在大约 4.2–4.5 秒时以 `fetch failed`、没有 HTTP 状态失败，和共享客户端 4 秒建连超时一致。早先成功的调用是 0.56–1.7 秒。千问因此改用 10 秒建连。当时任务在大约 14 秒内被判失败；现在若错误码表明请求还没写出，任务会保持待提交并在截止前重试。
- 这两次成功任务的 `provider_params.vendor.cost` 当时是 0，因为 DashScope 不回传金额。现在按目录价写入。

## 仍待验证

1. **`n>1` 命中哪一段 JSON。** Pro 两张已经能解析并落库，但那次日志还没有 `imageShape`。解析器仍按 `choices[].message.content[].image`、`content[].url`、`output.results[].url`、`data[].url` 的顺序收集。下一次 `n>1` 看 `bailian-usage` 的 `imageShape`。
2. **尺寸对齐是不是普遍规则。** 上面两个 1K 尺寸已被接受。3.0 文档仍只写面积和宽高比，没有写必须是 16 的倍数。2K 的 16:9（2688×1536）和 4:3（2368×1728）还没实测；和画布预设差超过 1% 时，现有裁切会按请求比例裁掉一圈。
3. **`negative_prompt` 长度。** 3.0 只说支持反向提示词，没写上限；旧版 qwen-image 写的是 500 字。P0 不发送这个字段。
4. **失败是否向阿里云收费。** “调用失败不收费”写在旧版 qwen-image 文生图页，3.0 模型页没有重复这句话。无论供应商是否收费，任务失败、审核拒绝或超时都会把预扣积分退回。建连阶段的重试不会产生 task id。
5. **RPM 怎么计。** 模型页写 3.0 是 20 RPM、Pro 是 5 RPM。按主账号、业务空间还是 API Key 合并，以及 `GET /tasks` 算不算进 RPM，仍然没有文档。提交遇到瞬时 429 会排队再试，不再在请求里连打。查询遇到 429 仍保持进行中，直到任务截止再退款。并发上限是应用层的保护，不是百炼账号的令牌桶；多个排队任务仍可能在同一秒重试。
6. **3500 字中文是否超过 4500 Token。** 提示词上限沿用现有 3500 字符。官方建议不超过 4500 Token，没有给出汉字换算。
7. **`UNKNOWN`。** 文档说这是任务不存在或状态未知。300 秒截止远小于 24 小时查询窗口，所以 `UNKNOWN` 先当作进行中，截止后再按超时退款。`FAILED` 和 `CANCELED` 立即失败。
8. **`submit_time` 的真实格式。** 日志按响应里的字符串原样记录，还没用真实任务核对过字段名和时区。
