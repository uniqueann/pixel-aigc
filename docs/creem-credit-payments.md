# Creem 美元积分充值接入与验收

更新日期：2026-10-09。本期两个通道统一美元，Dodo Payments 为默认通道，Creem 为可选通道。沿用 EDM 商户，但商品、回调和签名密钥独立。AIGC 使用一次性积分订单和现有账本，不使用 EDM 的订阅授权或套餐表。折扣码规则、配置与验收见 [折扣码接入说明](credit-discount-codes.md)。

## 一、商户商品

在 Creem 的 TEST、LIVE 中分别配置下面三档 AIGC 商品；可核对已有商品后复用，不能复用 EDM 订阅商品 ID。

| 建议商品名称 | 套餐 ID | 积分 | 美元含税价 | 金额最小单位 |
| --- | --- | ---: | ---: | ---: |
| Pixel AIGC Starter Credits | starter | 100 | $2.99 | 299 |
| Pixel AIGC Standard Credits | standard | 320 | $6.99 | 699 |
| Pixel AIGC Studio Credits | studio | 1150 | $19.99 | 1999 |

商品设为 `billing_type=onetime`、`currency=USD`、`tax_mode=inclusive`。一次购买数量为 1，不设置任意金额或商品默认折扣。沿用 EDM 商户时，优惠码必须明确限定为当前环境的 AIGC 商品；全商品券、混合 EDM 商品的券不支持。合法单码百分比优惠可自动到账，优惠规则、含税应付与交易实付无法核对时进入人工核对。

## 二、环境配置

| 配置 | 本地 / Preview | Production |
| --- | --- | --- |
| 运行范围 | local / preview | production |
| Creem API | test-api.creem.io | api.creem.io |
| API 密钥 | AIGC_CREEM_TEST_API_KEY | AIGC_CREEM_LIVE_API_KEY |
| 回调签名密钥 | AIGC_CREEM_TEST_WEBHOOK_SECRET | AIGC_CREEM_LIVE_WEBHOOK_SECRET |
| 体验包商品 | AIGC_CREEM_TEST_STARTER_PRODUCT_ID | AIGC_CREEM_LIVE_STARTER_PRODUCT_ID |
| 常用包商品 | AIGC_CREEM_TEST_STANDARD_PRODUCT_ID | AIGC_CREEM_LIVE_STANDARD_PRODUCT_ID |
| 工作室包商品 | AIGC_CREEM_TEST_STUDIO_PRODUCT_ID | AIGC_CREEM_LIVE_STUDIO_PRODUCT_ID |

共同配置：

- `AIGC_CREDIT_CURRENCY=USD`；Dodo 当前环境商品也须对应上述美元价。历史订单按原金额和币种查单、退款。
- `AIGC_PUBLIC_ORIGIN` 使用对应部署的固定站点 origin。付款返回 `/?creditOrder=<内部订单 UUID>`，只触发查询。
- `AIGC_PAYMENTS_ENABLED=true` 是既有充值总开关。
- `AIGC_CREEM_ENABLED=false` 是默认状态；配置完整并完成该环境验收后设置为 `true`。
- API 与签名密钥仅放服务端，Vercel 使用 Secret 类型，不加 `VITE_` 前缀，也不写入仓库或日志。变更线上变量后重新部署使其生效。

TEST 与 LIVE 密钥、商品和签名密钥不得互相回退。Creem 的商户 API 密钥可以使用同一商户的对应环境密钥，运行权限为 `checkouts:read`、`checkouts:write`、`products:read`、`transactions:read`；使用折扣预验证及付款页新增折扣核验还需要 `discounts:read`。缺少权限时，应创建 AIGC 专用密钥。商品与优惠码通过商户控制台配置，运行密钥不必授予商品写入、折扣写入、订阅、现金退款或 webhook 管理权限。AIGC 回调签名密钥须来自 AIGC 专属 endpoint，不能复制 EDM 的 webhook secret。

## 三、Webhook 与到账

在 TEST、LIVE 分别注册对应 AIGC HTTPS 地址：`/api/payments/creem/webhook`。仅订阅 `checkout.completed`、`refund.created`、`dispute.created`；确认部署保护或 WAF 不拦截该路径。

1. 保留原始请求体，用 `creem-signature` 验证 HMAC-SHA256，再处理事件。
2. Checkout metadata 绑定 `productScope=aigc`、`orderId`、`userId`、`runtimeScope`、`paymentMode`。EDM 事件不能改变 AIGC 积分。
3. 服务端重新查询 Checkout 和交易。校验一次性含税商品、单件数量、订单与账号、交易关联、币种、实付与折扣。
4. 实付以交易 `amount_paid` 为准，不能用目录金额填充缺失收据。积分由现有订单事务写入，幂等键为 `order:<内部订单 UUID>`。
5. 退款以查询交易的累计 `refunded_amount` 为准；确认结果尚未反映事件时返回 503，等待平台重试，不记已处理事件。重复与乱序事件不能重复扣回积分。
6. 争议、余额不足、先退款后到账走现有人工核对流程。现金退款仍先由管理员审核、冻结未使用积分，再到原平台操作退款。

Checkout 返回商品可能是 ID 或对象。商品后续改价不会改写旧订单；结算使用该订单的付款快照。定时补偿继续使用现有 pending 订单查询任务。

## 四、验收顺序

### 本地自动化

运行 `npm test`、`npm run build`、`npm run lint`、`git diff --check`。重点覆盖实付与折扣、环境隔离、默认 Dodo、通道关闭、账号切换、连续部分退款、重复和乱序事件、先退款后到账。

单元测试的支付平台返回值受控；PGlite 验证真实 SQL、事务和 RLS，但不代表远程 Supabase、多连接并发或真实商户支付已经通过。

### Creem TEST 商户联调

- 三档商品分别创建 Checkout，用平台测试支付完成购买，核对 Checkout、真实签名回调、订单、积分流水和刷新后的余额。
- 用两个独立登录账号验证订单和余额隔离；核对 local、preview 与 EDM 事件互不影响。
- 重放付款回调、模拟返回页早于回调、通过订单查询补偿，确认整包积分只到账一次。
- 完成全额退款及两次连续部分退款，重放旧事件，确认按累计金额扣回且不重复扣分。
- 关闭 `AIGC_CREEM_ENABLED` 后确认新入口消失、Dodo 可用、已有 Creem 订单仍能到账和处理退款。

### LIVE 与开放入口

先完成 LIVE 商品和专属 webhook 配置。用户发起一笔明确授权的 $2.99 体验包付款，核对到账及刷新，再按既有人工审核流程验证原路退款。记录真实平台订单与流水结果后开放入口。

异常时设置 `AIGC_CREEM_ENABLED=false` 并重新部署，停止新 Creem 订单；保留密钥和 webhook，继续处理已有付款及退款。交付报告分别记录本地、TEST、LIVE 验证结果，不能用本地测试代替真实收款验收。

## 五、本次本地验收记录

2026-10-08 验证结果：

- `npm test -- --maxWorkers=2 --minWorkers=1`：219 个测试文件、1368 项测试全部通过。
- `npm run build`、`npm run lint`、`git diff --check`：通过。
- 本地美元目录已配置，`AIGC_CREEM_ENABLED=false`，尚未开放 Creem 新订单入口。
- 本地自动化不包含真实 TEST / LIVE 付款、退款和双账号验收；后续商户配置及线上检查结果见第六节。

## 六、现场配置记录（2026-10-08）

商户为与 EDM 相同的 Pixel-Store。TEST、LIVE 均已创建以下独立一次性商品，价格为美元含税价：

| 套餐 | 积分 | 含税价 | TEST 商品 ID | LIVE 商品 ID |
| --- | ---: | ---: | --- | --- |
| starter | 100 | $2.99 | prod_4szwiqxklglNY8XjIgH5yz | prod_2is1JOTNMsfTCwKRPFAceH |
| standard | 320 | $6.99 | prod_2K5YiXehAHFefE56gyL19d | prod_6xn1yWKPRlbPQyHOHkdpxO |
| studio | 1150 | $19.99 | prod_3p1LHYmm9S6voUhKB0mKZS | prod_3PGEKPlguR4LZvqKUDRWgm |

已配置：

- LIVE 三档商品 ID 已写入 AIGC Vercel Production；TEST 三档商品 ID 已写入 Preview、Development 和本机 `.env.local`。
- 已创建 `pixel-aigc-test-api-key` 和 `pixel-aigc-live-api-key`，均仅授予 `checkouts:read`、`checkouts:write`、`products:read`、`transactions:read`。LIVE 密钥作为 Secret 写入 Production；TEST 密钥作为 Secret 写入 Preview、Development，并保存到本机私有配置。EDM 原密钥的权限未改动。
- LIVE 独立回调为 `Pixel AIGC Production Webhook`，ID 为 `wh_5sYgYKp3HSmxzpD6Nf0ExL`，地址为 `https://aigc.contentup.cc/api/payments/creem/webhook`，仅订阅 `checkout.completed`、`refund.created`、`dispute.created`。
- TEST 独立回调为 `Pixel AIGC Test Webhook`，ID 为 `wh_test_xUYhhNrzMo2qyWk5II9ib`，使用 `https://pixel-aigc-git-payments-test-ningnings-projects-2ed21e15.vercel.app/api/payments/creem/webhook`，也仅订阅上述三类事件。经用户明确授权，实际回调地址增加现有 Vercel 自动化访问凭据的查询参数；文档不记录凭据或完整私有 URL，项目部署登录保护保持启用。
- 两个回调均已启用，签名密钥彼此独立。LIVE 签名密钥作为 Secret 写入 Production；TEST 签名密钥作为 Secret 写入 Preview、Development，并保存到本机 `.env.local`。密钥不使用 `VITE_` 前缀，不写入 Git。
- Production、Preview 的 `AIGC_CREEM_ENABLED=false`；原 Dodo 配置、EDM 商品与回调均未改动。

部署与配置验收：

- 六个商品已通过对应环境的真实 Creem API 查询，金额、USD、一次性计费、含税和 SaaS 税类均匹配。Checkout、交易读取的不存在编号探针返回 404，未出现权限不足；这不代表真实付款收据验收。
- Preview 部署 `dpl_EcJLHUv2TLJAuL6Q7uYr6WwExRPo` 已就绪，并绑定既有 `payments-test` 预览地址。该部署明确设置 `runtimeScope=preview`、充值总开关启用、Creem 入口关闭及纯 origin 返回地址。
- Production 部署 `dpl_1bjZahUzLuK78SEU94u9Au3X3At6` 先构建暂存，检查后发布至 `https://aigc.contentup.cc`。两次部署均使用 `main` 基线 `bea981b` 加当前工作区的 Creem 接入改动，上传清单已确认排除本机密钥、`.env.local` 和 `.vercel`。
- TEST、LIVE 回调分别执行 Creem 控制台的 `checkout.completed` 示例投递，均返回 HTTP 200、`{"received":true,"ignored":true}`。示例没有真实 AIGC 订单，因此被忽略；该结果验证实际平台投递、验签及端点可达，不代表充值到账。
- Production 自定义域名的受控 HTTP 检查通过：无签名、错误签名、TEST 签名均返回 401；LIVE 签名有效，EDM 事件和 Preview 事件均返回 200 并被忽略。检查不创建订单或积分流水。
- 正式充值面板已使用现有登录会话核对：显示 USD 三档价格 $2.99 / $6.99 / $19.99，仅提供 Dodo Payments；Creem 入口保持关闭，历史 Dodo 订单仍可显示。
- Production 部署检查期间的四条 error 日志均对应预期的 401 验签拒绝探针，没有发现其他运行错误。Preview 的本机 HTTP 客户端遇到 TLS 连接中断，因此没有把本机 Preview 负向探针记为通过；Creem TEST 平台到该地址的实际签名投递已成功。

开放前待验收：

- 本次接入改动需先通过 PR 合并，再继续从 `main` 自动发布。合并前，`main` 旧实现不识别独立的 `AIGC_CREEM_ENABLED` 开关；重新发布旧版本会覆盖当前配置验收版本并重新展示 Creem 通道。
- TEST 三档实际支付、全额及连续部分退款、重复回调、查询补偿和双账号隔离尚未验收。联调时只在测试部署开启 Creem，Production 保持关闭。
- LIVE 的 $2.99 实付及原路退款仍需用户明确授权，并按既有人工审核流程执行。完成实际订单、积分流水、余额和退款核对后，再开放正式入口。

## 七、折扣权限与密钥轮换（2026-10-09）

- 经用户即时确认，已创建 `pixel-aigc-test-discount-api-key` 与 `pixel-aigc-live-discount-api-key`。两者保留原四项运行权限，仅增加只读 `discounts:read`，不授予折扣写入或现金退款权限。
- TEST 替代密钥已作为 Secret 更新至 Preview、Development；LIVE 替代密钥已作为 Secret 更新至 Production。本机私有配置已同步，原密钥暂留供现有部署使用；本轮没有重新部署应用。
- 两环境的三档商品查询均为 HTTP 200；不存在折扣、Checkout、交易的查询均为 HTTP 404，查询权限通过核验。该检查没有创建付款或退款。
- 本轮核对时 Production 的 `AIGC_CREEM_ENABLED=true`，Preview 的 `creem-test` 分支也已有开启配置；本轮保留现有开关。第六节中的关闭状态为当时的历史记录，不代表当前配置。
- 折扣规则、数据库迁移与后续实际付款验收见 [充值折扣码接入与验收](credit-discount-codes.md)。

## 官方参考

- [创建 Checkout](https://docs.creem.io/api-reference/endpoint/create-checkout)
- [查询 Checkout](https://docs.creem.io/api-reference/endpoint/get-checkout)
- [查询交易与实付、累计退款](https://docs.creem.io/api-reference/endpoint/get-transaction)
- [Webhook 验签与事件](https://docs.creem.io/code/webhooks)
- [Vercel Secret 环境变量](https://vercel.com/docs/environment-variables/sensitive-environment-variables)
