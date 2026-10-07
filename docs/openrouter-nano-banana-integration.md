# Google Nano Banana 2.1（OpenRouter）

更新时间：2026-10-07。

`AI_GATEWAY_IMAGE_ENABLED=true` 且已配置 AI Gateway 凭证时，这个模型改走 Vercel AI Gateway，见 `docs/ai-gateway-nano-banana.md`。下面的 OpenRouter 路径仍然保留：Gateway 开关关闭、且 `OPENROUTER_IMAGE_ENABLED=true` 并配置了 `OPENROUTER_API_KEY` 时才会用到。

把 OpenRouter 上的 `google/gemini-nano-banana-2.1` 接进现有图片任务层。默认关闭。关闭时模型列表、能力开关和其他模型的提交方式都不变。

官方说明：

- 模型页：https://openrouter.ai/google/gemini-nano-banana-2.1
- 图片生成（chat completions，`modalities: ["image","text"]`）：https://openrouter.ai/docs/guides/overview/multimodal/image-generation

本次没有数据库迁移。`image_jobs.provider` 与 `model_profile_id` 已经是文本字段。

## 行为

- 使用 OpenRouter **同步** chat completions：`POST {OPENROUTER_BASE_URL}/chat/completions`。请求体带 `modalities: ["image","text"]` 和 `image_config.aspect_ratio` / `image_config.image_size`（`1K` / `2K` / `4K`，必须大写）。不发送 `plugins`、`tools`，也不开启 web search。
- 张数大于 1 时按现有扇出，每张图一次请求（`n` 固定为 1），并发由 `OPENROUTER_IMAGE_MAX_PARALLEL` 限制（默认 4，上限 4）。预扣按张数乘以该分辨率单价，结算按实际返回张数，失败退还，沿用现有预扣/结算。
- 参考图作为 `image_url` 内容片段跟在文本后面，最多 14 张。不另加积分。不接受蒙版。
- 比例：`1:1`、`3:2`、`2:3`、`3:4`、`4:3`、`4:5`、`5:4`、`1:4`、`4:1`、`1:8`、`8:1`、`9:16`、`16:9`、`21:9`、`9:21`。4K 不降档。自由画布预设仍是 1:1 / 4:3 / 3:4 / 16:9 / 9:16。工作站在非 DragonCode 模型上按模型自己的比例显示预览，1:1 的 4K 显示为 `1:1 · 4K`。
- 能力：`text_to_image`、`image_edit`、`variation`。不是 `defaultFor`，未指定模型时仍走 GPT Image 2。工作站的精修、融合、重新打光共用 `image_edit` 模型列表。
- 目录里 `enabled` 保持 `false`，积分说明和本地 Mock 模型列表因此不会出现它。服务端只在 `OPENROUTER_IMAGE_ENABLED=true` 且已配置 `OPENROUTER_API_KEY` 时列入 `GET /api/image-models`。报价来自 `creditsPerImage`：1K 4、2K 6、4K 14。公开接口不返回 `vendorCost`。
- 生成发生在提交阶段。图片字节写入 R2 `temporary/openrouter-results/{requestId}/{ordinal}.img`，用量写在同前缀的 `.usage.json`。任务号编码对象键、MIME 和用量。同一请求、同一序号在同一次进程里去重；对象已存在则直接复用，不再打上游。付费请求不自动重试。
- 首次轮询延迟默认 130 秒，长于 Vercel 函数 120 秒上限，避免另一次轮询在生成尚未落库时再提交一单。提交成功后会在同一次请求里把临时图收进正式结果，用户不用等这段延迟。单次 HTTP 超时默认 70 秒（限制在 5–110 秒），任务截止默认 300 秒。
- 用量：`openrouter-image-submit` 和任务层 `openrouter-usage` 记录 `prompt_tokens`、`completion_tokens`、`total_tokens`。上游若返回 `usage.cost`，原样写入 `provider_params.vendor`（货币 USD）；没有成本字段时按目录单价乘以返回张数（1K `0.039359`、2K `0.059038`、4K `0.137755`，与 AI Gateway 目录价相同）。日志不记 API Key、提示词或图片 base64。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `OPENROUTER_IMAGE_ENABLED` | 关闭 | 只有精确的 `true` 才列出模型 |
| `OPENROUTER_API_KEY` | | 与开关同时配置才可用。不要用 `VITE_` 前缀 |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | 只认 https。末尾斜杠会去掉 |
| `OPENROUTER_IMAGE_REQUEST_TIMEOUT_MS` | `70000` | 单次 chat completions 超时，限制 5000–110000 |
| `OPENROUTER_IMAGE_TASK_TIMEOUT_MS` | `300000` | 任务截止。超时退款 |
| `OPENROUTER_IMAGE_POLL_INTERVAL_MS` | `2000` | 收结果的轮询间隔，最小 1000 |
| `OPENROUTER_IMAGE_INITIAL_POLL_DELAY_MS` | `130000` | 长于函数上限，避免并发生成时再打一单 |
| `OPENROUTER_IMAGE_MAX_PARALLEL` | `4` | 扇出并发，限制 1–4 |

## 上线

1. 不需要跑数据库迁移。
2. 在 Vercel Preview 先设置 `OPENROUTER_API_KEY`，再设置 `OPENROUTER_IMAGE_ENABLED=true`。Production 等 Preview 冒烟后再开。
3. 重新部署。
4. 登录后看 `GET /api/image-models?operation=text_to_image`（工作站看 `image_edit` 或 `variation`）。应出现 `openrouter:gemini-nano-banana-2.1`，积分 1K/2K/4K 为 4/6/14，响应里没有 `vendorCost`。不传 `modelProfileId` 的文生图仍走 GPT Image 2。
5. 自由画布和工作站选中该模型后，预扣应显示 4 / 6 / 14。用一张 1K 做冒烟，确认结果进了画布和 R2。
6. 核对日志 `openrouter-image-submit`、`openrouter-usage` 和任务上的 `provider_params.vendor`（token 数；有上游成本则用上游成本，否则用目录价）。
7. 不要开启 web search。参考图不另加积分。失败应退回预扣。

## 已知限制

若函数在 OpenRouter 已经出图、任务号尚未写入数据库时被杀掉，之后的轮询可能再提交一次，供应商可能记两笔费用。用户积分在失败时仍会退回。用量 sidecar 写失败不会让已经出图的那张失败；重放时若读不到 sidecar，成本回退到目录价。
