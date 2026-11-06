# GPT Image 2.6（Vercel AI Gateway）

更新时间：2026-11-06。

在 DragonCode 的 GPT Image 2 之外，增加一个可选模型。目录 id 是 `gpt-image-2.6-flare`，展示名是「GPT Image 2.6」，不把 Flare 写进标题。`defaultFor` 仍只在 `dragoncode:gpt-image-2` 上，文生图、智能编辑和裂变不传模型时还是 GPT Image 2。

只接 `openai/gpt-image-2.6-flare`。不接 Sunburst，也不接 2.5。`aigc.image_jobs.provider` 写成 `ai-gateway`，`vendor` 是 `openai`。这个字段是没有检查约束的 `text`，不需要迁移。

Nano Banana 继续只用 `AI_GATEWAY_IMAGE_ENABLED`。本模型不看那个开关。

## 请求

OpenAI 的图像模型在 Gateway 上是 image-only，不走 Chat Completions，也不写 `buildAiGatewayChatBody` 的 `providerOptions`。

鉴权、超时和 R2 临时结果与 Nano Banana 共用：`AI_GATEWAY_API_KEY` 优先，否则用 `@vercel/oidc` 的 `getVercelOidcToken()`。`AI_GATEWAY_BASE_URL` 默认 `https://ai-gateway.vercel.sh/v1`，只认 https。

- 没有参考图：`POST /v1/images/generations`
- 有参考图（编辑、裂变、融合）：`POST /v1/images/edits`，`images` 为 `{ "image_url": "<签名 URL>" }` 数组，最多 16 张
- `model`：`openai/gpt-image-2.6-flare`
- `quality`：固定 `medium`。不把 `auto`、`high`、`xhigh`、`max` 交给上游。官方说明里，同一尺寸的 `high` 大约是 `medium` 的四倍输出 token
- `n`：1。多张仍按现有扇出，每次请求一张
- 不传蒙版。`supportsMask` 为 false，和 GPT Image 2 一样

界面上的比例加 1K/2K/4K 会收成 `size=WIDTHxHEIGHT`。约束来自 OpenAI Images API（gpt-image-2 及之后，Gateway 未另给一套尺寸）：

- 宽和高都能被 16 整除
- 长短边之比不超过 3:1
- 单边不超过 3840
- 总像素在 655360 和 8294400 之间
- 高于 2560×1440 的分辨率官方标为实验性

长边先对齐档位：1K 为 1024，2K 为 2048，4K 为 3840，再在合法尺寸里选长边最接近的一档。因此：

| 比例 | 1K | 2K | 4K |
|---|---|---|---|
| 1:1 | 1024×1024 | 2048×2048 | 2880×2880 |
| 16:9 | 按上式 | 2048×1152 | 3840×2160 |

4K 正方形不能用 3840×3840，像素会超过 8294400。2880×2880 刚好等于上限。可选比例与 GPT Image 2 相同，不含 `auto`，避免丢掉分辨率档位。1:8、8:1 超出 3:1，不提供。

结果在 `data[].b64_json`。解码后写入现有的 `temporary/ai-gateway-results/` 对象，再由任务层收成正式结果。

## 成本与积分

Gateway 标价大约是输入 $5/M token、输出 $30/M token，没有按尺寸的一口价。真实账单会随质量和参考图变化。本仓库不在 CI 里打付费生图，下面的输出锚点来自 OpenAI 对 `gpt-image-2`、`quality=medium` 的公开计算器（2026-10）。2.6 Flare 的分档 token 表还没有公布；Flare 是更快的小模型，用 gpt-image-2 的 medium 输出价当上限。

| 档位 | 本仓库会请求的偏贵尺寸 | gpt-image-2 medium 输出 |
|---|---|---|
| 1K | 1024×1024 | $0.05268（1756 output tokens） |
| 2K | 2048×2048 | $0.10704（3568 output tokens） |
| 4K | 2880×2880，或 16:9 的 3840×2160 | 3840×2160 为 $0.10008。正方形按 1024→2048 的 token 倍率沿长边外推，约 4939 token、$0.148 |

积分按工作室包折算。$19.99 / 1150 积分 = $0.01738/积分，这是三档充值里最便宜的单价。GPT Image 2 和 Nano Banana 仍是 1K 4、2K 6、4K 14，不改。Nano Banana 1K 的实测成本约 $0.039，4 积分在工作室包大约只覆盖 1.8 倍。若 2.6 也收 4 分，1K 的工作室包收入约 $0.070，扣掉 $0.053 的输出后几乎盖不住提示词和参考图。

因此 `creditsPerImage` 定为 **1K 8、2K 16、4K 28**：

| 档位 | 积分 | 工作室包收入 | 相对上表输出价 |
|---|---:|---:|---:|
| 1K | 8 | $0.139 | 约 2.6 倍，还剩约 $0.086（约 1.7 万输入 token） |
| 2K | 16 | $0.278 | 约 2.6 倍，还剩约 $0.171 |
| 4K | 28 | $0.487 | 相对 $0.15 的外推约 3.2 倍 |

参考图不加积分，和 GPT Image 2、Nano Banana 一样。16 张高分辨率参考图仍可能超过这档积分。任务会优先记下上游 `usage.cost`；没有 cost 但有 `input_tokens` / `output_tokens`（或 chat 风格的 `prompt_tokens` / `completion_tokens`）时，按 $5/M 与 $30/M 估算，保留 6 位小数。只有 `total_tokens`、两边都没有时，用目录 `vendorCost` 乘以实际张数，并写上 `vendorCurrency: USD`，这样现有的 `applyCatalogVendorCost` 才能补上。目录回退价是输出锚点再加一截输入余量，不是用户积分：

| 档位 | vendorCost（USD） |
|---|---|
| 1K | 0.090000 |
| 2K | 0.150000 |
| 4K | 0.220000 |

公开的 `/api/image-models` 和任务接口都不返回 `vendorCost`。`quality` 保持 medium 是保证金的前提。若上游忽略 quality，2K 的 high 在 gpt-image-2 上大约是 $0.43，会高于 16 积分。上线后用任务里的 `usage.cost` 再核对。

GPT Image 2 的目录短标签是「若想生成更快，可选 GPT Image 2.6」。`/api/image-models` 只在 GPT Image 2.6 同时出现在列表里时下发这句；否则仍是「支持 4K」，避免指向一个没开放的模型。只有一个模型时下拉不显示标签。

## 错误与退款

与 Nano Banana 共用 `classifyAiGatewayFailure`：

- 402 映射为 `INSUFFICIENT_BALANCE`
- 403 的服务条款、`customer_verification_required`，以及非免费层的 `no_providers_available`，映射为 `PROVIDER_FORBIDDEN`
- 免费层的 `no_providers_available` 映射为 `INSUFFICIENT_BALANCE`
- 明确的审核拒绝映射为 `CONTENT_REJECTED`
- 非 2xx 日志去掉 Bearer、API Key 和 OIDC 令牌
- 失败走现有任务终态，预扣积分全额退回。付费请求不自动重试

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_GATEWAY_GPT_IMAGE_ENABLED` | 关闭 | 只有精确的 `true` 才把 GPT Image 2.6 列进 `/api/image-models`。不读取 `AI_GATEWAY_IMAGE_ENABLED` |
| `AI_GATEWAY_API_KEY` | | 与 Nano Banana、邮件、视频共用。不要用 `VITE_` 前缀 |
| `VERCEL_OIDC_TOKEN` | Vercel 注入 | 没有 API Key 时使用。`VERCEL=1` 也视为可以走 OIDC |
| `AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v1` | 只认 https |
| `AI_GATEWAY_IMAGE_REQUEST_TIMEOUT_MS` | `70000` | 与 Nano Banana 共用，限制 5000–110000 |
| `AI_GATEWAY_IMAGE_TASK_TIMEOUT_MS` | `300000` | 与 Nano Banana 共用 |
| `AI_GATEWAY_IMAGE_POLL_INTERVAL_MS` | `2000` | 与 Nano Banana 共用 |
| `AI_GATEWAY_IMAGE_INITIAL_POLL_DELAY_MS` | `130000` | 与 Nano Banana 共用 |
| `AI_GATEWAY_IMAGE_MAX_PARALLEL` | `4` | 与 Nano Banana 共用，限制 1–4 |

## 上线

1. 部署本改动。不需要数据库迁移。
2. 确认已有 `AI_GATEWAY_API_KEY` 或项目 OIDC。再单独设置 `AI_GATEWAY_GPT_IMAGE_ENABLED=true`。不要为了这个模型去改 `AI_GATEWAY_IMAGE_ENABLED`。
3. 登录后看 `GET /api/image-models?operation=text_to_image`，以及 `image_edit`、`variation`。应同时看到 `dragoncode:gpt-image-2` 和 `gpt-image-2.6-flare`。展示名是「GPT Image 2.6」，积分 8/16/28，`supportsMask` 为 false，响应里没有 `vendorCost`。不传 `modelProfileId` 时仍是 GPT Image 2，预扣仍是 4/6/14。GPT Image 2 的选项旁有「若想生成更快，可选 GPT Image 2.6」。
4. 开关保持关闭时，模型列表与现在一致。只打开 `AI_GATEWAY_IMAGE_ENABLED` 时出现的是 Nano Banana，不是 GPT Image 2.6。
5. 用一张 1:1 的 1K 做冒烟，确认请求打到 `/v1/images/generations`，`quality` 为 `medium`，`size` 为 `1024x1024`，任务 `provider` 为 `ai-gateway`。再各抽一张带参考图的编辑（应打到 `/v1/images/edits`）和 4K，确认 `provider_params.vendor.cost` 有值。不要把真实生图放进 CI。
6. 失败应退回全部预扣。日志里的 `ai-gateway-image-submit` 不应出现密钥。
