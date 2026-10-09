# 邮件助手平台模型上线说明

## 范围与价格

平台开放 DeepSeek Flash、DeepSeek V4 Pro、Gemini 3.8 Flash。型号、语种及价格定义在 `shared/email-models.ts`；价格版本为 `aigc-email-v1`，成功一次分别扣 1／3／3 积分。单封与批量同价，不增加免费次数，赠送积分正常扣减。四种操作分别计为一次；重新生成需要新请求 ID。

默认选择顺序：用户本次选择、已保存默认型号、输出语言推荐。中文和日语默认 Flash；英语及新增欧洲语种默认 Gemini。中文与欧美语种的推荐属于产品引导，不能当成真实质量评测结果。混合批次没有个人默认时要求选择型号。输入模板仍为原四列，整个批次固定一个型号。

## 接入与配置

先执行 `20261009105115_email_platform_models.sql`，再部署代码，所有开关保持关闭。迁移只扩充 AIGC 邮件任务字段和函数，不改 EDM 钱包，不追溯扣历史任务。

服务端配置 `EMAIL_ASSIST_ENABLED`、`DEEPSEEK_EMAIL_ENABLED`、`AI_GATEWAY_EMAIL_ENABLED`，初始均为 `false`。DeepSeek 使用 `DEEPSEEK_API_KEY`；Gateway 使用已有 `AI_GATEWAY_API_KEY`，缺省时读取 Vercel OIDC。邮件与图片鉴权共用，开关和响应处理独立，不修改图片开关、模型及预算。没有 `CRON_SECRET` 不得开放邮件服务。所有密钥禁止使用 `VITE_` 前缀，local／preview／production 各自配置。

通过 `GET /api/model-profiles?capability=email_assist` 获取型号、单价、价格版本与配置可用性；配置可用不代表供应商已通过真实调用验收。`GET /api/model-settings` 只返回默认型号，`PATCH /api/model-settings/email` 接受平台型号或 `null`。旧个人凭据接口返回 `410 BYOK_REMOVED`。

新 `POST /api/tasks` 必须携带 `modelProfileId` 和 `priceVersion`，缺失或过期报价返回 `PRICE_CHANGED`。已存在请求按原参数校验并返回原任务；任务返回实际扣费、预扣、计费状态和价格版本。Gateway 固定调用 `google/gemini-3.8-flash`，低思考档，不使用跨型号回退或自动重试。

DeepSeek 最大输出 1,600 Token、请求超时 40 秒；Gemini 总输出预算 2,048 Token（包括思考）、请求超时 70 秒；邮件前端超时 85 秒，任务固定截止时间 90 秒。空文本、截断、安全拦截及供应商错误失败返还。过长的完整改写可能超出输出预算，不能把截断内容标为成功。

## 积分事务与长期幂等

创建和预扣同事务；成功结果与结算同事务；失败终态与退款同事务。沿用 `credit_accounts` 和 `credit_ledger`，遵守支付冻结。邮件收口统一账户锁在任务锁之前，私有收口实现不授予应用角色。所有操作以用户与 scope 隔离。

财务流水仅保存型号、操作、价格版本和请求指纹；不保存原文、用户指导或结果。请求 ID 对应的预扣幂等键长期保留。任务删除或超过 7 天后，同 ID 返回 `TASK_EXPIRED`，不能再次提交付费生成。任务内容保留 7 天，流水长期保留。旧免费任务保留 `legacy_free` 标识，不补扣。

浏览器超时或离页不会立即退款；已提交任务可继续完成。状态未知时原请求查询恢复；单封未知请求锁定表单，可查询或以同一标识恢复，批量未知请求阻止下一行。已失败手动重试才建立新标识。供应商余额／鉴权故障提示平台服务暂不可用，个人积分不足才提示充值。

## 分钟补偿与每日清理

`POST /api/internal/email-maintenance` 校验 `CRON_SECRET`，每次最多收口当前 scope 的 100 个超时任务。关闭生成后继续维护。`GET /api/internal/email-cleanup` 保留现有 Vercel 每日调度，先收口，再删除过期且已结算的内容。迟到结果不能对已退款任务再次结算。

分钟维护使用 Supabase Cron、pg_net、Vault，避免依赖 Vercel 套餐的分钟调度能力。先在控制台核对扩展是否启用；以下为生产模板，预览使用独立名称、固定可访问 URL 及独立服务端秘密。不要覆盖视频、图片或支付调度。受保护预览须确保调度能访问此内部接口，否则不能开放生成。

在 Vault 安全保存入口 URL 和与当前环境一致的 CRON_SECRET；同名 Secret 已存在时通过 ID 更新，不能重复创建。实际秘密不得提交代码或打印到日志。

```sql
-- 在控制台创建 aigc_email_maintenance_url_production 和 aigc_email_maintenance_secret_production 后注册。
select cron.schedule(
  'aigc-email-maintenance-production', '* * * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='aigc_email_maintenance_url_production'),
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' ||
      (select decrypted_secret from vault.decrypted_secrets where name='aigc_email_maintenance_secret_production')),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $cron$
);
```

必须核对 `cron.job_run_details`、pg_net HTTP 响应和应用返回的 `expired` 计数；只看到计划任务存在不算退款验证。用测试任务验证关闭页面后余额自动恢复、另一环境不受影响、每日清理保留流水。

## 旧凭据清理

停止旧接口并确认该环境没有旧版处理请求后，运行以下管理员脚本。默认只统计，显式 `--execute` 才删除指定环境数据，不显示凭据内容。使用本地 `AIGC_ADMIN_DATABASE_URL`，不可部署管理员连接。

```bash
npx tsx --env-file-if-exists=.env.local scripts/email-credentials-cleanup.ts preview
npx tsx --env-file-if-exists=.env.local scripts/email-credentials-cleanup.ts preview --execute
```

表结构暂不删除；不要恢复旧个人密钥读取路径。原 `AIGC_CREDENTIAL_KEY_V1` 在旧请求全部结束、所有环境完成切换后可从部署配置移除。

## 验收与发布门槛

自动检查：`git diff --check`、`npm test`、`npm run build`、`npm run lint`。数据库测试覆盖预扣、结算、重复退款、迟到成功、长期幂等、冻结、RLS、环境隔离和清理；本地真实 PostgreSQL 验收已覆盖最后一积分竞争、相同请求并发、迟到成功与补偿竞争、图片与邮件共享余额，以及正文删除后禁止重复调用。供应商响应在这些检查中使用占位测试响应，没有真实付费调用。

可在空的本地 PostgreSQL 数据库重跑：

```bash
EMAIL_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/pixel_email_test npx tsx scripts/email-concurrency-check.ts
```

脚本拒绝非本机地址、非测试库名称和已存在 AIGC schema 的数据库。

真实验收分别调用三个型号，覆盖四种操作、所有新增语种、短邮件及接近上限的邮件；验证每次任务费用、结果完整性、思考用量、失败返还和批量暂停恢复。Gateway 的 generation ID 与供应商用量保存在 `vendor_usage`／`token_usage`；费用通过供应商账单及 Gateway generation 查询核对，不把 Token 估算写成实际成本。测试与真实调用结论分别记录。

激活前重新获取 [Gateway 目录](https://ai-gateway.vercel.sh/v1/models)，核对型号和费率，并查看 [Google 定价](https://ai.google.dev/gemini-api/docs/pricing)。Gemini 公告的促销结束价变化应纳入评估。近输入上限有效样本的供应商费用不得超过相应积分净收入（包括支付折扣和费用）；超出则保持该型号关闭并重新评估预算／价格，不能直接宣称毛利已验证。

真实账号隔离使用两个独立登录账号；控制测试或模拟账号 ID 不代替该验收。依次完成迁移、部署、分钟维护验证、供应商调用与成本核对后才开启对应开关。异常时关闭生成，继续历史查询、补偿与清理；保留账本，通过修复前进恢复，不回退到免费提交或个人 Key 模式。

本轮代码实现不代表已执行远程迁移、注册远程调度、配置凭据或完成真实付费调用。
