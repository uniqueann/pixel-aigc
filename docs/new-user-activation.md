# 新用户提示与三个使用事件

首页“最近作品”确认没有本机与云端作品后，显示可关闭的新用户卡片，说明实际首次赠送额度并直达智能抠图。新钱包赠送 30 积分，抠图每个上海自然月免费 20 张；卡片读取真实赠送流水，不把老钱包的历史 100 分说成 30 分。

读取、同步或错误状态不显示卡片。看到过作品、曾有成功结算或已关闭卡片后不再显示。首次进入工作台还会看到一行可关闭的积分说明：先预扣，只按成功张数结算，失败或超时退回。已读与关闭状态按账号和运行环境存入数据库，本机仅缓存已读标记，并在网络恢复或下次登录时补交。迁移前已有钱包的账号标记为已读，后续首次进入本环境的账号才自动展示说明。

图片工作站、工具箱、邮件助手与自由画布的顶栏标题旁统一提供“?”，直达对应帮助文章。工具箱和画布补充了独立文章。

## 事件口径

| 事件 | 触发条件 |
| --- | --- |
| registration_complete | 本账号首次创建当前运行环境钱包，真实首次赠送账本入账。通常是邮箱验证或 Google 登录后首次进入 AIGC；不是共享 Supabase 全局账号的创建时间 |
| first_upload | 图片文件通过类型、大小与解码校验，或批量邮件 CSV 导入成功且至少一行可生成。选择文件、失败导入、Logo、历史资产引用不算 |
| first_generation_success | 服务端出现有成功结果的积分结算。包括图片、视频、邮件和免费抠图；预扣、退款、空结果、模拟任务与本机水印／裁剪不算 |

事件保存在 `aigc.user_activation_events`，主键为账号、环境、事件，每个事件最多一条。只保存用户 UUID、环境、事件、时间、工具或能力名称，不保存邮箱、图片、邮件正文、文件名或提示词。

注册和成功事件由积分流水触发器生成，随原事务提交或回滚，后台完成也能记录。客户端不能伪造这两个事件；首次上传接口只接收指定事件和工具。上传上报不阻塞操作，失败时保留工具名，在线恢复或下次登录补交；发生时间采用服务端收到上报的时间，离线补交可能晚于实际选择文件的时间。

“设置 → 数据控制 → 帮助改进 Pixel AIGC”控制后续事件记录，关闭后停止采集；已有事件保留，账号删除时联动删除。提示状态的保存不受统计开关影响。

## 部署与验证

先执行 `20261010065807_new_user_activation.sql`，再部署应用。迁移仅新增欢迎状态表、事件表及账本触发器，不改变额度、计费或已有余额。首次应用会从真实账本回填注册和成功时间，不猜测历史上传时间。

本地使用 PGlite 执行迁移并验证去重、免费成功、退款与空结果排除、事务回滚、统计故障不影响结算、RLS 和统计开关；组件测试覆盖空状态、同步等待、读取失败、关闭后刷新、账号切换、历史赠送与深链。这些检查不替代线上迁移、真实登录与供应商成功生成验收。

## 查询新用户转化

使用管理连接查询，应用账号只允许读取自己的事件。将下面起始日期改为正式埋点上线时间，旧账号回填数据不应混入上线后的新用户队列。

```sql
with registered as (
  select user_id,occurred_at from aigc.user_activation_events
  where scope='production' and event='registration_complete'
    and occurred_at >= timestamptz '2026-10-10 00:00:00+08'
), milestones as (
  select r.user_id,
    bool_or(e.event='first_upload') as uploaded,
    bool_or(e.event='first_generation_success') as succeeded
  from registered r left join aigc.user_activation_events e
    on e.user_id=r.user_id and e.scope='production'
    and e.occurred_at >= r.occurred_at
  group by r.user_id
)
select count(*) as registered,
  count(*) filter(where uploaded) as uploaded,
  count(*) filter(where succeeded) as succeeded,
  count(*) filter(where uploaded and succeeded) as uploaded_and_succeeded,
  count(*) filter(where succeeded and not uploaded) as succeeded_without_upload
from milestones;
```

文生图、文生视频与单个邮件可以直接成功而不上传素材，因此成功未上传也是正常路径。注册、上传、成功三项覆盖率不等于严格线性漏斗；统计关闭的账号不再产生后续事件，离线补交也会影响时间顺序。
