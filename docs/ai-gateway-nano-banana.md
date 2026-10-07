# Google Nano Banana 2.1（Vercel AI Gateway）

更新时间：2026-10-07。

OpenRouter 对 Google 模型会因地区限制返回 403。`AI_GATEWAY_IMAGE_ENABLED=true` 且凭证就绪时，同一个模型 `openrouter:gemini-nano-banana-2.1` 改走 Vercel AI Gateway。OpenRouter 适配器保留，Gateway 关闭后仍可按原开关启用。

没有数据库迁移。`aigc.image_jobs.provider` 是没有检查约束的 `text`。新任务的 `provider` 写成 `ai-gateway`。TypeScript 里的供应商联合类型增加了这个值。

## 请求

`POST https://ai-gateway.vercel.sh/v1/chat/completions`，`Authorization: Bearer <token>`。

- `model`：`google/gemini-nano-banana-2.1`
- `modalities`：`["text","image"]`（[Chat Completions 图片生成](https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/image-generation)）
- `stream`：`false`
- 宽高比和分辨率不使用 OpenRouter 的 `image_config`。那个字段在 Gateway 上没有生效，1:1 / 1K 曾返回 1376x768。
- 采用 Chat Completions 的 `providerOptions`（[Provider options](https://vercel.com/docs/ai-gateway/models-and-providers/provider-options)），字段对齐 AI SDK 的 `providerOptions.google.imageConfig` 与 `providerOptions.vertex.imageConfig`（[Google](https://ai-sdk.dev/providers/ai-sdk-providers/google)、[Vertex](https://ai-sdk.dev/providers/ai-sdk-providers/google-vertex)）：

```json
{
  "providerOptions": {
    "google": { "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" } },
    "vertex": { "imageConfig": { "aspectRatio": "1:1", "imageSize": "1K" } }
  }
}
```

`google` 和 `vertex` 写同一份配置。实测该写法返回 200、1024x1024，`usage.cost` 为 `0.0393585`。2K、4K 和其他比例还没有线上实测，上线后需要再确认输出尺寸。

图片在 `choices[0].message.images[].image_url.url`，是 base64 data URL。`usage.cost` 原样写入 `provider_params.vendor`（USD）。上游没给成本时，按目录价乘以返回张数：1K `0.039359`（由实测 `0.0393585` 按 6 位小数四舍五入），2K `0.059038`、4K `0.137755`（按积分比 6/4、14/4 估算，不是实测）。积分仍是 1K 4、2K 6、4K 14。

## 错误与退款

- R2 对象不存在按 404 处理，首次提交继续请求上游。
- 402 映射为 `INSUFFICIENT_BALANCE`。
- 403 的服务条款、`customer_verification_required`，以及非免费层的 `no_providers_available`，映射为 `PROVIDER_FORBIDDEN`。
- 免费层的 `no_providers_available` 映射为 `INSUFFICIENT_BALANCE`。
- 明确的审核拒绝映射为 `CONTENT_REJECTED`。
- 非 2xx 日志记录上游消息，并去掉 Bearer、API Key 和 OIDC 令牌。
- 失败走现有任务终态，预扣积分全额退回。付费请求不自动重试。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `AI_GATEWAY_IMAGE_ENABLED` | 关闭 | 只有精确的 `true` 才把 Nano Banana 改到 AI Gateway |
| `AI_GATEWAY_API_KEY` | | 优先使用。不要用 `VITE_` 前缀 |
| `VERCEL_OIDC_TOKEN` | Vercel 注入 | 没有 API Key 时，用 `@vercel/oidc` 的 `getVercelOidcToken()`。`VERCEL=1` 也视为可以走 OIDC |
| `AI_GATEWAY_BASE_URL` | `https://ai-gateway.vercel.sh/v1` | 只认 https |
| `AI_GATEWAY_IMAGE_REQUEST_TIMEOUT_MS` | `70000` | 单次请求超时，限制 5000–110000 |
| `AI_GATEWAY_IMAGE_TASK_TIMEOUT_MS` | `300000` | 任务截止。超时退款 |
| `AI_GATEWAY_IMAGE_POLL_INTERVAL_MS` | `2000` | 收结果的轮询间隔，最小 1000 |
| `AI_GATEWAY_IMAGE_INITIAL_POLL_DELAY_MS` | `130000` | 长于函数上限，避免并发生成时再打一单 |
| `AI_GATEWAY_IMAGE_MAX_PARALLEL` | `4` | 扇出并发，限制 1–4 |

## 上线

1. 不需要跑数据库迁移。
2. 在 Vercel 设置 `AI_GATEWAY_API_KEY`（或确认项目已启用 OIDC，从而有 `VERCEL_OIDC_TOKEN`），再设置 `AI_GATEWAY_IMAGE_ENABLED=true`。不要同时把流量留在 OpenRouter：两个开关都开时只走 Gateway。
3. 重新部署。登录后看 `GET /api/image-models?operation=text_to_image`。模型 id 仍是 `openrouter:gemini-nano-banana-2.1`，积分 4/6/14，响应里没有 `vendorCost`。
4. 用一张 1:1 的 1K 做冒烟，确认结果是约 1024x1024，任务上的 `provider` 为 `ai-gateway`，`provider_params.vendor.cost` 接近 `0.0393585`。再各抽一张 2K 和 4K，确认比例和尺寸。
5. 失败应退回全部预扣。日志里的 `ai-gateway-image-submit` 不应出现密钥。
