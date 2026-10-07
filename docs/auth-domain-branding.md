# Auth 域名与 Google 品牌配置

目标：Google 登录授权页使用可识别的业务域名与应用品牌，降低新用户对随机 Supabase 项目域名的疑虑。用户已选择先完成 Google 品牌配置，暂不增加自定义域名费用；本次未开通 `auth.contentup.cc`，正在使用的环境变量继续指向原 Supabase 域名。以下域名步骤保留为后续实施方案。

## 当前核查结果

2026-10-07 核查：

| 项目 | 结果 |
| --- | --- |
| 共享 Supabase 项目 | `content-up`，项目标识 `gnrhyahjegvcicektebh` |
| AIGC 站点 | `https://aigc.contentup.cc` |
| 真实 Google 授权回调 | `https://gnrhyahjegvcicektebh.supabase.co/auth/v1/callback` |
| Google Cloud 项目 | `contentup` |
| Google OAuth 客户端 | `801131657559-kcs2om3cvj8kp46hefar2u9v96iu7420.apps.googleusercontent.com`，名称 `contentup` |
| Google 品牌页面 | 应用名称已由 `md2htm` 改为用户确认的 `ContentUp Pixel AIGC`，已保存 Logo、主页、隐私政策和服务条款 |
| Google 应用发布状态 | 已由测试切换为正式版，用户类型为外部 |
| Google 品牌验证 | 已通过并点击“发布品牌”；控制台确认“您的品牌已经过验证，正在向用户显示” |
| 网站所有权 | `https://aigc.contentup.cc/` 已在同一 Google 账号下通过 Search Console HTML 元标记验证；不等同于主域名的 DNS 资源验证 |
| 公开产品介绍页 | `https://aigc.contentup.cc/about` 已部署到生产，明确显示 `ContentUp Pixel AIGC`、功能、共用账号说明及政策链接 |
| Google 数据隐私说明 | `https://aigc.contentup.cc/privacy` 已上线，补充 Google 登录数据的获取、用途、存储、共享、保留及撤销授权/删除请求方式 |
| 真实生产品牌展示 | 从生产登录页点击 Google，账号选择页显示 P Logo 和“继续前往 ContentUp Pixel AIGC”，政策链接指向新页面 |
| 已声明的数据权限 | `openid`、`https://www.googleapis.com/auth/userinfo.email`、`https://www.googleapis.com/auth/userinfo.profile`，均为非敏感范围 |
| 已获授权的网域 | `contentup.cc`、`gnrhyahjegvcicektebh.supabase.co` |
| `auth.contentup.cc` DNS | 尚未解析；主域名 DNS 由 Cloudflare 托管 |
| Supabase 自定义域名资格 | `domains get` 返回 `entitlement_required`，要求 Pro 或更高套餐及 Custom Domain 附加项 |

上述 Google 客户端 ID 与真实 Supabase 授权响应中的 `client_id` 一致。当前项目代码已支持任意有效 Supabase URL，浏览器会话存储键固定为 `pixel-aigc-auth`，无须新增登录实现。

## 费用与影响范围

Supabase 自定义域名是付费套餐上的附加项，官方价格为每小时 0.0137 美元，约每月 10 美元，另计基础套餐费用。实际套餐和开通价格以控制台为准。用户已明确选择暂不增加费用，本次未升级套餐或开通付费附加项。

一个 Supabase 项目只能绑定一个自定义域名。虽然这里命名为 `auth.contentup.cc`，它是项目入口，也能承载该项目的其他 Supabase API。激活后，项目级 Auth 的 OAuth 回调会使用新域名，ContentUp、AIGC、EDM 都在影响范围内。

品牌信息同样作用于 Google Cloud 项目内的 OAuth 应用。用户已确认使用 `ContentUp Pixel AIGC`，品牌发布后其他共用应用的授权页也会使用该品牌名称。

## Google 品牌配置

入口：[当前 Google 品牌页面](https://console.cloud.google.com/auth/branding?project=contentup)。

| 字段 | 已保存值 |
| --- | --- |
| 应用名称 | `ContentUp Pixel AIGC` |
| Logo | `public/brand/pixel-oauth-logo.png`，绿色圆角底深色 P，120 × 120 PNG，2146 字节 |
| 用户支持邮箱、开发者联系邮箱 | 保留当前已配置邮箱 |
| 应用首页 | `https://aigc.contentup.cc/about` |
| 隐私政策 | `https://aigc.contentup.cc/privacy`，补充说明并链接既有 `https://contentup.cc/privacy` 总政策 |
| 服务条款 | `https://contentup.cc/terms` |
| 已获授权的网域 | 保留已有 `contentup.cc` 和旧 Supabase 网域 |

已核实生产介绍页、Logo、隐私政策和服务条款均返回 HTTP 200。Logo 根据 AIGC 现有 `app-brand-mark` 制作，沿用主色 `#21cfa0`、文字色 `#06251d` 与 P 标识；可编辑源文件为 `public/brand/pixel-oauth-logo.svg`，PNG 用于 Google 上传。

保存品牌字段不等于品牌验证通过。Google 对外部生产应用的名称和 Logo 有品牌验证要求，还需确认受众、发布状态、网站所有权，以及主页和政策内容是否符合当前应用范围。当前首页为 AIGC 站点上的公开介绍页，明确说明产品名称、功能及其与 ContentUp 的关系；同域名隐私政策补充 Google 数据处理说明，并链接既有共享总政策。

控制台已确认保存 `ContentUp Pixel AIGC`、现有 Logo、新首页与新政策地址。应用已发布为正式版，仅声明三个基础非敏感权限。首次品牌检查拒绝 `Pixel AIGC` 的名称及原首页，因此按用户确认的新名称修正，并验证 AIGC 网站所有权后重新提交。第二次检查只指出旧共享隐私政策的内容不足，已根据 `server/auth.ts`、账号初始化与模型请求实现补充现有 Google 数据处理方式。第三次检查通过，随后点击“发布品牌”，控制台明确确认品牌已经过验证并正在向用户显示。曾出现的网站所有权 24 小时同步提示已不再构成本次发布阻碍。

生产展示已通过实际页面验证：从 `https://aigc.contentup.cc/login` 点击“使用 Google 登录”，Google 账号选择页显示绿色 P Logo、`继续前往 ContentUp Pixel AIGC` 以及同域名新隐私政策链接。请求中的客户端标识、`scope=email profile` 及原 Supabase 回调均保持不变。本次停在账号选择页面，没有选择账号或完成登录回调，因此不等同于独立新用户的完整登录验收。

### 生产介绍页部署记录

- 基线：现网 `main` 提交 `f25bd84a75139bd94442de410736251f2b8b896e`，通过隔离工作树增加静态页面和验证元标记，避免带入当前功能分支的其他改动。
- 文件：`public/about.html`、`public/privacy.html`、`public/brand/` 的 Logo 和共用 `pages.css`、`index.html` 验证元标记及 `vercel.json` 中 `/about`、`/privacy` 的精确重写；`src/cloud/AuthPages.tsx` 的公共介绍与政策入口。
- 平台：既有 Vercel 项目 `pixel-aigc`，最终部署 `dpl_v582CmUxwvnHweXzo5opbkdXYENm`；通过生产环境构建候选部署后提升为正式部署。首个介绍页部署为 `dpl_8XKynQqCw264j2MJymmMs5PSMvXL`，政策中间候选 `dpl_AFAe7J4uJNpmW94FESWeTHGgv7P2` 未提升到正式域名。
- 验证：本地构建、Lint 和差异空白检查成功；浏览器页面正常。正式域名匿名访问介绍页、政策页、共用 CSS 返回 200，全文与源码一致；Logo 返回 200；工作台 HTML 保留验证元标记；`/api/me` 返回预期 401 JSON `AUTH_REQUIRED`。独立浏览器已确认真实生产登录页的 Google 按钮及三个新增入口。这些检查不代表独立新账号完整登录验收。
- Search Console 元标记：`XI55njDX2gu9wrLq5PrFZczEwzv1jG_eaftykFcm1Zs`，须保留在 `index.html` 与公开介绍页中，以维持网站验证状态。
- 介绍页、政策、Logo 和网站验证元标记由本仓库维护；后续部署须包含上述文件，以保留公开页面及网站验证状态。
- 生产授权页与已发布控制台的截图已保存在本次任务的交付记录中。

## 自定义域名切换顺序

1. 确认使用 `auth.contentup.cc` 和付费预算，在 Supabase 开通符合要求的套餐及 Custom Domain 附加项。
2. 在 Cloudflare 添加 CNAME：`auth` → `gnrhyahjegvcicektebh.supabase.co`，使用仅 DNS 模式。保留现有主站、AIGC、EDM 的记录。
3. 在 Supabase 注册域名，按其实际返回的记录添加 `_acme-challenge.auth.contentup.cc` TXT；不能猜测或复用其他项目的验证值。完成 DNS 验证，确认 TLS 证书就绪。
4. 在 [当前 Google OAuth 客户端](https://console.cloud.google.com/auth/clients/801131657559-kcs2om3cvj8kp46hefar2u9v96iu7420.apps.googleusercontent.com?project=contentup) 的“已获授权的重定向 URI”中追加 `https://auth.contentup.cc/auth/v1/callback`，保留 `https://gnrhyahjegvcicektebh.supabase.co/auth/v1/callback` 及其他已有条目。此步骤必须先于 Supabase 域名激活。
5. Supabase 的应用回跳允许列表仍使用各应用自己的地址，保留 ContentUp、EDM 和 AIGC 条目。AIGC 包含 `https://aigc.contentup.cc/auth/callback` 及其 `?next=/reset-password` 恢复地址；不要把 Google 的 `/auth/v1/callback` 与 AIGC 的 `/auth/callback` 混淆。
6. 激活 Supabase 自定义域名，先检查真实 `/auth/v1/authorize` 响应中的 Google `redirect_uri` 已切换到新域名。
7. 分环境更新 AIGC 的 URL 并重新部署。逐一检查共享应用和本地开发环境，再继续品牌验证与完整登录验收。

本仓库已锁定 Supabase CLI，可先通过 `--help` 核对命令。以下命令会修改平台配置，仅在上述预算和前置步骤完成后执行：

```sh
# 注册域名，取得该项目的 DNS 验证记录。
npx --no-install supabase domains create --project-ref gnrhyahjegvcicektebh --custom-hostname auth.contentup.cc

# 添加实际返回的 TXT 后，验证域名及证书。
npx --no-install supabase domains reverify --project-ref gnrhyahjegvcicektebh

# 确认 Google 已保存新旧两个回调 URI、证书就绪后，再激活。
npx --no-install supabase domains activate --project-ref gnrhyahjegvcicektebh
```

## AIGC 环境变量

域名激活后，目标配置为：

```dotenv
VITE_AIGC_SUPABASE_URL=https://auth.contentup.cc
SUPABASE_URL=https://auth.contentup.cc
```

`src/cloud/client.ts` 优先读取 `VITE_AIGC_SUPABASE_URL`，为空时才使用 `VITE_SUPABASE_URL`。已设置覆盖值的环境中，只修改 `VITE_SUPABASE_URL` 不会生效。使用旧名称的本地环境也需同步检查。

前端 `VITE_` 变量在构建时写入，修改 Vercel 的 Production 或 Preview 配置后必须重新部署。保持 publishable key、用户池、数据库连接串、PKCE 流程及 `pixel-aigc-auth` 存储键；域名调整不需要迁移用户或重置积分。

Supabase 当前官方文档说明旧项目域名继续提供请求服务；仍须实测旧地址与现有会话，不能据此直接宣称共享应用已兼容。正在进行的 OAuth 登录若跨越切换窗口失败，应重新从登录入口发起。

## 验收与回退

- DNS 和证书：新域名 CNAME 正确，TLS 正常，Auth 端点可访问。
- 授权跳转：真实 Supabase 授权响应中的 `redirect_uri` 为 `https://auth.contentup.cc/auth/v1/callback`，Google 未出现 `redirect_uri_mismatch`。
- 品牌显示：用未授权过的新用户验证业务域名、名称和 Logo；测试用户页面与品牌审核通过后的生产页面分别留证据。
- 登录完成：AIGC 的 PKCE 回调成功，`/api/me` 验证身份成功，仍使用原有 Auth UUID、工作空间和积分。
- 共享回归：ContentUp、AIGC、EDM 的 Google 登录和既有会话刷新均通过；再检查邮箱登录、共享验证邮件、密码恢复和退出登录。
- 状态报告：分别记录“品牌字段已保存”“域名已激活”“品牌验证已通过”“真实登录已通过”，不能把文档、配置保存或 HTTP 302 当成完整验收。

若出现问题，先查 Google 新回调是否保存、Supabase 域名与证书状态、前端部署中的实际 URL 和回跳允许列表。仅把前端 URL 改回旧域名不会撤销已激活的项目级 OAuth 回调；撤销自定义域名前须确认 Google 旧回调仍保留，并按 Supabase 官方移除流程恢复，再回归共享应用。不要通过重置项目、用户或数据库排查域名问题。

## 官方参考

- [Supabase 自定义域名配置与激活前准备](https://supabase.com/docs/guides/platform/custom-domains)
- [Supabase 自定义域名费用](https://supabase.com/docs/guides/platform/manage-your-usage/custom-domains)
- [Supabase Google 登录品牌配置](https://supabase.com/docs/guides/auth/social-login/auth-google)
- [Google OAuth 应用品牌与验证要求](https://support.google.com/cloud/answer/15549049)
