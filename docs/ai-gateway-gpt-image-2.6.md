# GPT Image 2.6（Vercel AI Gateway）

更新时间：2026-11-06。

在 DragonCode 的 GPT Image 2 之外，增加可选模型「GPT Image 2.6」。目录 id 是 `gpt-image-2.6-flare`，不带渠道；展示名不写 Flare。上游模型是 `openai/gpt-image-2.6-flare`。默认模型仍是 `dragoncode:gpt-image-2`，`defaultFor` 不变。

这个模型只在 `AI_GATEWAY_GPT_IMAGE_ENABLED=true` 且 Gateway 凭证就绪时出现在 `GET /api/image-models`。不要用 `AI_GATEWAY_IMAGE_ENABLED` 打开它，那个开关只负责 Nano Banana。目录里 `enabled` 保持 `false`，积分说明和本地 Mock 因此不会列出它。

`aigc.image_jobs.provider` 仍是没有检查约束的 `text`。新任务写成 `ai-gateway`，`vendor` 为 `openai`。不需要迁移。

2.6 出现在列表里时，GPT Image 2 的下拉短标签改成「更快请选 2.6」。2.6 自己的短标签是「生成更快」。开关关闭时，GPT Image 2 仍显示「支持 4K」。

## 请求

OpenAI 图像模型在 Gateway 上是 image-only，走 Images API，不走 Chat Completions，也不使用 Nano Banana 的 `providerOptions.google` / `vertex`。

- 文生图：`POST https://ai-gateway.vercel.sh/v1/images/generations`
- 带参考图的编辑、裂变、融合：`POST https://ai-gateway.vercel.sh/v1/images/edits`，最多 16 张。JSON 体用 `images: [{ "image_url": "https://..." }]`（[编辑图片](https://vercel.com/docs/ai-gateway/modalities/image-generation/openai)）
- `model`：`openai/gpt-image-2.6-flare`
- `quality`：固定 `medium`。不接受 low / high / xhigh / max，避免质量把 token 成本抬上去
- `n`：1。多张仍由任务层扇出
- `response_format`：`b64_json`
- 蒙版保持关闭（`supportsMask: false`）

界面上的比例和 1K / 2K / 4K 映射成 `size=WIDTHxHEIGHT`。约束来自 OpenAI 图像文档：宽高都是 16 的倍数，长短边不超过 3:1，单边不超过 3840，总像素在 655360 和 8294400 之间。长边目标是 1K 1024、2K 2048、4K 3840；4K 不能用 4096。正方形 4K 会被总像素上限收到 2880×2880。1K 的 16:9 若按 1024×576 会低于像素下限，因此抬到 1088×608。超过 3:1 的原图会收到 3:1 内最近的合法尺寸。

结果优先用 `data[].b64_json`，偶发 https 地址时再下载。字节写入现有的 `temporary/ai-gateway-results/` 临时对象，和 Nano Banana 共用读取与恢复。

## 成本与积分

Gateway 模型目录（2026-11-06）对 `openai/gpt-image-2.6-flare` 的标价是输入 `$0.000005` / token（$5/M）、输出 `$0.00003` / token（$30/M），没有按尺寸的固定单价。真实花费随质量和参考图变化。本接入把质量锁在 medium，仍要给参考图和提示词留余量。

输出 token 用 OpenAI 文档页计算器里 GPT Image 2.6、medium 的公式估算（不是线上实测）。该档最贵的是正方形：

| 档位 | 尺寸 | 输出 token | 仅输出成本 |
|---|---|---|---|
| 1K | 1024×1024 | 1449 | $0.043470 |
| 2K | 2048×2048 | 2944 | $0.088320 |
| 4K | 2880×2880 | 4894 | $0.146820 |

这三档写入目录 `vendorCost`，`vendorCurrency` 为 `USD`，只覆盖输出、不含文本和参考图。上游返回 `usage.cost` 时原样记下。没有金额但有 `input_tokens` / `output_tokens`（或 `prompt_tokens` / `completion_tokens`）时，按 $5/M 与 $30/M 还原。两者都没有时，现有的 `applyCatalogVendorCost` 用上表乘以返回张数。

积分不沿用 GPT Image 2 / Nano Banana 的 4/6/14。按最便宜的工作室包估算收入：1150 积分 / ¥99，约 ¥0.086/积分；按 7.2 的汇率约 $0.012/积分。

| 档位 | 积分 | 约合收入 | 相对仅输出成本 |
|---|---|---|---|
| 1K | 10 | $0.120 | 约 2.8 倍 |
| 2K | 18 | $0.216 | 约 2.4 倍 |
| 4K | 32 | $0.384 | 约 2.6 倍 |

美元工作室包（$19.99 / 1150，约 $0.0174/积分）余量更大。2K 比旧档的 4→6 抬得更多，因为正方形 2K 的输出成本大约是 1K 的两倍，而旧档只加了 50%。16 张参考图的输入 token 没有摊进每一张单价；上线后如果 `usage.cost` 经常高于这个缓冲，再调积分。DragonCode 和 Nano Banana 的报价不变。

## 错误与退款

与 Nano Banana 的 Gateway 适配器相同：402 为 `INSUFFICIENT_BALANCE`，403 的服务条款与核验失败为 `PROVIDER_FORBIDDEN`，审核拒绝为 `CONTENT_REJECTED`。非 2xx 日志去掉 Bearer、API Key 和 OIDC。失败走现有任务终态，预扣积分全额退回。不在 CI 或本地自动化里打付费生图。

## 环境变量

凭证、基址和超时与 Nano Banana 共用。开关独立。

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_GATEWAY_GPT_IMAGE_ENABLED` | 关闭 | 只有精确的 `true` 才列出并调用 GPT Image 2.6 |
| `AI_GATEWAY_API_KEY` | | 优先使用。不要用 `VITE_` 前缀 |
| `VERCEL_OIDC_TOKEN` | Vercel 注入 | 没有 API Key 时走 OIDC。`VERCEL=1` 也视为可以走 OIDC |
| `AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v1` | 只认 https |
| `AI_GATEWAY_IMAGE_REQUEST_TIMEOUT_MS` | `70000` | 单次请求超时，限制 5000–110000 |
| `AI_GATEWAY_IMAGE_TASK_TIMEOUT_MS` | `300000` | 任务截止。超时退款 |
| `AI_GATEWAY_IMAGE_POLL_INTERVAL_MS` | `2000` | 收结果的轮询间隔，最小 1000 |
| `AI_GATEWAY_IMAGE_INITIAL_POLL_DELAY_MS` | `130000` | 长于函数上限，避免并发生成时再打一单 |
| `AI_GATEWAY_IMAGE_MAX_PARALLEL` | `4` | 扇出并发，限制 1–4 |

## 上线

1. 部署本改动。没有数据库迁移。
2. 确认已有 `AI_GATEWAY_API_KEY` 或 OIDC，再设置 `AI_GATEWAY_GPT_IMAGE_ENABLED=true`。不要为了 2.6 去打开 `AI_GATEWAY_IMAGE_ENABLED`。
3. 登录后看 `GET /api/image-models?operation=text_to_image`（`image_edit` 和 `variation` 同样）。应同时看到 `dragoncode:gpt-image-2` 与 `gpt-image-2.6-flare`。默认仍是 GPT Image 2。2.6 的展示名是「GPT Image 2.6」，积分 10/18/32，响应里没有 `vendorCost`。GPT Image 2 的短标签是「更快请选 2.6」。
4. 用一张 1:1 的 1K 做冒烟，确认请求打到 `/v1/images/generations`，`quality` 为 `medium`，`size` 为 `1024x1024`，任务 `provider` 为 `ai-gateway`。带参考图的编辑应打到 `/v1/images/edits`。
5. 失败应退回全部预扣。日志里的 `ai-gateway-image-submit` 不应出现密钥或 base64。
