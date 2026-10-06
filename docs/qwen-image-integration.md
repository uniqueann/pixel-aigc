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
- 成功图片沿用现有转存：下载后写入 R2。供应商 URL 24 小时失效，不能拿来长期展示。
- 两个模型的 `enabled` 在注册表里保持 `false`，积分说明和本地 Mock 模型列表因此不会出现它们。服务端只在开关打开且 Key 可用时把它们放进 `GET /api/image-models`。画布报价读的是这个接口，所以预览里打开开关后，生成面板的预估积分是对的；积分页说明仍只写 GPT Image 2，留给 P1。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `QWEN_IMAGE_ENABLED` | 关闭 | 只有精确的 `true` 才列出模型 |
| `QWEN_IMAGE_API_KEY` | `DASHSCOPE_API_KEY` | 必须和地域、业务空间一致 |
| `QWEN_IMAGE_BASE_URL` | `DASHSCOPE_BASE_URL`，再回退 `https://dashscope.aliyuncs.com` | 只认 https origin。生产建议 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com` |
| `QWEN_IMAGE_MODELS` | 两个都允许 | 逗号分隔。未知 id 忽略。只填 `qwen-image-3.0` 可以不开放 Pro |
| `QWEN_IMAGE_PROMPT_EXTEND` | `true` | `false` 关闭智能扩写。关闭时请求里的 `enable_thinking` 也会是 `false` |
| `QWEN_IMAGE_THINKING` | `true` | 官方默认会提高质量并增加耗时。设 `false` 可缩短等待 |
| `QWEN_IMAGE_TASK_TIMEOUT_MS` | `300000` | 任务截止。超时退款。远小于 task_id 的 24 小时查询窗口 |
| `QWEN_IMAGE_POLL_INTERVAL_MS` | `3000` | 首次之后的轮询间隔，最小 3000 |
| `QWEN_IMAGE_INITIAL_POLL_DELAY_MS` | `5000` | 提交后第一次查询前的等待 |
| `QWEN_IMAGE_MAX_PARALLEL` | `1` | 千问走批量 `n`，这个值只在意外扇出时限制并发 |
| `QWEN_IMAGE_REQUEST_TIMEOUT_MS` | `30000` | 单次提交或查询的 HTTP 超时 |
| `QWEN_IMAGE_REQUEST_RETRY_COUNT` | `2` | 限流、5xx 和连接失败的请求内重试次数 |

模型目录里的建议积分（开关打开后才会真正预扣）：3.0 为 1K/2K 各 3 分；Pro 为 1K 4 分、2K 8 分。`vendorCost` 按北京地域人民币记录，公开接口不返回该字段。

比例使用 1:1、4:3、3:4、16:9、9:16。没有 4K。客户端如果草稿里是 4K，现有逻辑会先降到 2K 再提交；直接传 4K 会被服务端拒绝。

## 在 Vercel Preview 打开

1. 确认 Preview 环境已有可用的北京地域 `DASHSCOPE_API_KEY`（消除/重绘/扩图那把），或者另设 `QWEN_IMAGE_API_KEY`。Key、模型和 `DASHSCOPE_BASE_URL` 必须属于同一地域、同一业务空间。
2. 给 Preview 增加 `QWEN_IMAGE_ENABLED=true`。不要在 Production 打开。
3. 如果已经改用业务空间域名，把 `DASHSCOPE_BASE_URL` 或 `QWEN_IMAGE_BASE_URL` 设成 `https://{WorkspaceId}.cn-beijing.maas.aliyuncs.com`，不要带 `/api/v1`。
4. 重新部署该 Preview。
5. 登录后看 `GET /api/image-models?operation=text_to_image`。应返回 GPT Image 2 和两个千问模型，响应里没有 `vendorCost`。不传 `modelProfileId` 的文生图仍走 GPT Image 2。
6. 用一张 1K、数量 1 的描述做冒烟，确认结果进了画布和 R2，而不是停在供应商 URL 上。Pro 建议数量大于 1 时看网络日志，确认只有一次上游提交。

## 仍待验证

这次没有可用的 `DASHSCOPE_API_KEY`，没有做真实调用。下面几项以 2026-10-06 读到的官方文档为准，文档没写死的地方按保守实现处理。

1. **`n>1` 的异步响应形状。** 异步成功示例只有一个 `choices[0].message.content[0].image`。OpenAI 兼容模式写明 `n>1` 时 `data` 有多个元素，但那不是我们用的异步接口。实现会按顺序收集每个 choice 的 `content[].image`（字符串或字符串数组），没有的话再看 `output.results[].url` 和 `data[].url`。真实是哪一种，要在 Preview 用 `n=4` 看一次。
2. **尺寸对齐。** 3.0 文档只要求总像素在 512×512 到 2048×2048 之间、宽高比 1:8 到 8:1，没有写必须是 16 的倍数。现在的像素表来自旧版 qwen-image 推荐分辨率，边长都是 16 的倍数，面积也落在 1K（≤2,250,000）或 2K 的计费档里。3.0 是否原样接受，要实测。2K 的 16:9（2688×1536）和 4:3（2368×1728）与画布预设比例差超过 1% 时，现有裁切会按请求比例裁掉一圈。
3. **`negative_prompt` 长度。** 3.0 只说支持反向提示词，没写上限；旧版 qwen-image 写的是 500 字。P0 不发送这个字段。
4. **失败是否收费。** “调用失败不收费”写在旧版 qwen-image 文生图页，3.0 模型页没有重复这句话。无论供应商是否收费，任务失败、审核拒绝或超时都会把预扣积分退回。
5. **RPM 怎么计。** 模型页写 3.0 是 20 RPM、Pro 是 5 RPM。按主账号、业务空间还是 API Key 合并，以及 `GET /tasks` 算不算进 RPM，图像 API 页没有写。批量 `n` 让一次生成只占一次提交。查询遇到 429 会保持进行中，直到任务截止再退款；提交在单次请求内重试，重试完仍失败则整单失败并退款，不会再次预扣。
6. **3500 字中文是否超过 4500 Token。** 提示词上限沿用现有 3500 字符。官方建议不超过 4500 Token，没有给出汉字换算，也还没用真实 usage 核对。
7. **`UNKNOWN`。** 文档说这是任务不存在或状态未知。300 秒截止远小于 24 小时查询窗口，过早判失败可能退掉一个还在排队的任务，所以 `UNKNOWN` 先当作进行中，截止后再按超时退款。`FAILED` 和 `CANCELED` 立即失败。
