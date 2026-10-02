# 主体检测缓存与智能选区耗时观测

## 本轮范围

分两轮实施。本轮为转比例的主体检测增加页面缓存、请求合并和取消隔离，为 `/api/subject-detect`、`/api/smart-select` 补齐观测。智能选区的轮廓算法、会话格式及现有缓存保持兼容，第二轮根据真实样本决定改动。

### 主体检测缓存

- 键由账号、当前 File 对象的弱引用身份、自然尺寸、检测版本组成。平台比例、输出尺寸、焦点设置不进入键，命中主体框后重新计算裁剪焦点。
- 每个页面最多 20 项；有效框保留 30 分钟，明确的空框保留 5 分钟，命中不延长过期时间。采用 LRU 淘汰，不持久化图片或框，不缓存失败、取消和无效响应。
- 同图同时读取共用准备和请求。单个使用方取消只取消自己的等待，全部取消中止底层请求。删除图片、清空、卸载、切换账号会清理缓存并阻止迟到响应写回。
- 批量并发仍为 3。取消检测后不会继续裁剪；取消网络请求不能保证腾讯服务端已经停止计算。
- 检测客户端的 55 秒截止时间覆盖图片准备、请求和响应正文；不能立即取消的浏览器解码在完成后释放位图，不继续提交。超时仍走原有九宫格兜底，主动取消不走兜底。

## 观测口径

复用 `aigc.sync_requests`，不新增表、列或计费逻辑。成功响应增加可选 `requestId`，请求增加可选 `clientTimingMs`，旧调用不带该字段仍有效。新增计时必须为允许键中的整数毫秒，范围为 0～300000。

| 来源 | 阶段 / 字段 | 说明 |
| --- | --- | --- |
| 浏览器 | read、decode、encode、base64 | 准备阶段，数据库以 clientRead 等键保存；直接解码 File 时没有 read 阶段 |
| 两接口 | inputParse | 图片 Base64 解码；鉴权及请求结构校验不计入该阶段 |
| 主体检测 | cosUpload、subjectDetect、subjectParse、subjectFallback、fallbackParse、cosCleanup | 回退阶段只在实际执行时出现；失败也保留已执行阶段 |
| 智能选区 | imagePrepare、cosUpload、matting、cosCleanup、alphaDecode | 首次调用腾讯时出现 |
| 智能选区 | cacheLookup、sessionDecode、sessionEncode、selectionBuild、selectionBBox、maskEncode | 缓存与轮廓构建；同名阶段累计毫秒 |
| 浏览器 | requestCount、requestBytes、responseReadMs、elapsedMs、outcome | 按实际 POST 计数，合并及本地命中不重复计数 |
| 服务端日志 | cacheSource | provider、image-cache、session-cache、session-restored；通过 requestId 与数据库关联 |

- `input_bytes`：主体检测为解码后的图片字节；智能选区为解码后的图片字节加输入会话 payload 的 UTF-8 字节。它不是完整 HTTP 请求大小。
- `output_bytes`：实际返回 JSON 序列化后的 UTF-8 字节，包含 Base64 蒙版、会话和 requestId。错误响应也按相同结构计算。
- `requestBytes`：实际序列化 JSON 的 UTF-8 字节，不含 HTTP 头。浏览器与服务端结构化日志均记录；请求重试会累计实际请求数和字节。
- `sessionBytes`、`outputSessionBytes`、`maskBytes`、`encodedMaskBytes` 仅记录长度，不记录内容。`stage_ms` 仅保存毫秒，其他属性保留在日志。
- 日志不输出原图、Base64、会话内容、访问令牌或签名地址。缓存命中不产生数据库请求记录，评估总请求下降必须结合浏览器日志。
- 限流或结构校验在请求记录取得之前失败时，仍使用原有接口错误日志。保留 7 天不会扩大限流统计窗口。

## 数据库迁移

`supabase/migrations/20261002031941_detection_metrics_retention.sql` 已于 2026-10-02 在 `content-up` 应用，远端版本为 `20261002031941`；本地文件与远端迁移历史一致。

迁移只替换 `aigc.purge_expired_sync_requests()` 的保留规则：新增两个检测路由保留 7 天，原 erase/repaint/outpaint/bg-remove 仍为 7 天，其余及空路由仍为 2 小时。没有主动调用清理函数。已核对空 search_path，anon/authenticated 不可执行，aigc_api 可执行。

代码回退无需回退此迁移，旧版本仍能使用同一表和函数。若需恢复原清理规则，应另建迁移，不修改已应用文件。

## 验证记录

- 118 个测试文件、633 项测试通过；生产构建和 lint 通过。覆盖缓存身份、绝对过期、空框、LRU、请求合并、独立取消、账号切换、删除、迟到响应、无效返回、正文超时、数据库状态及保留规则。
- 独立 Chromium 会话验证实际浏览器图片准备及 API 通信，使用本地受控检测提供方；智能选区运行真实服务端轮廓与会话逻辑。未以这些样本声明腾讯在线提速或抠图质量。
- 主体检测稳定序列：JPEG 大图、EXIF 旋转 JPEG、WebP、PNG 四张图首次处理产生 4 次 POST；随后切换三个平台共 12 次处理，12 次缓存命中，新增检测 POST 和输入字节均为 0。四张图每轮均完成裁剪。
- 7,165,557 字节、3200×5035 的测试 JPEG，检测工作图为 814×1280；工作 JPEG 240,818 字节，完整请求 JSON 约 321,213 字节。EXIF 旋转输入正确按 1200×800 显示和准备。
- 主体检测取消后页面恢复待处理，没有新增裁剪结果。开发代理上游可能继续执行，验收只断言客户端取消与结果隔离。
- 智能选区验证 provider、image-cache、session-cache 三条路径，三次选择只调用一次测试分割提供方；会话命中没有再次准备图片。点击背景返回未选中，原蒙版保留。
- 本地智能选区首图请求约 9,149 字节，而测试轮廓会话请求约 26,027 字节。平色小图的会话可能大于压缩图片，因此第二轮需要真实复杂图片样本，不能预设会话一定节省传输。
- 开发过程发生的 HMR、取消以及重复验证请求不混入稳定缓存序列统计。浏览器无未处理脚本错误，页面和蒙版展示已截图检查。

## 发布及在线验收

1. 数据库迁移已完成；PR 合并后部署应用。当前开发未主动部署或合并 PR。
2. 使用真实登录账号，在预览环境验证同图首次/第二次、跨平台裁剪、移除后重新上传、取消、账号切换、批量三并发及网络错误后的重试。
3. 智能选区验证首次识别、连续点击、会话失效恢复、点击背景、框选和服务端冷实例的 session-restored。确认视觉轮廓与修改前一致。
4. 核对两路由数据库行中的状态、requestId、输入/输出字节和阶段；按 requestId 查服务端来源日志，成功和失败均有阶段记录。
5. 分 scope 汇总，生产与预览不能混用。主要指标为实际请求数、输入/响应 JSON 字节及用户等待时间，再比较提供方、上传、缓存与轮廓阶段 p50/p95。

## 第二轮分析交接

截至开发前只读核对，生产近 7 天两个新路由可区分阶段样本均为 **0**，无可报告的真实阶段 p50/p95。已有其他图像工具样本不能替代检测样本。

使用下面的只读 SQL 汇总路由、环境、首次准备/会话复用及输入大小。至少分别记录样本量、成功率和分位数；缺少客户端阶段的旧调用也会落入“无图片准备计时”，必须结合 cacheSource 日志确认，不能直接当作缓存命中。小样本 p95 只作排查，不作上线提速承诺。

```sql
with samples as (
  select *,
    case when stage_ms ? 'clientDecode' then '图片准备'
         else '无图片准备计时' end as client_path,
    case when input_bytes < 262144 then '<256KiB'
         when input_bytes < 1048576 then '256KiB~1MiB'
         else '>=1MiB' end as input_size,
    extract(epoch from (completed_at-created_at))*1000 as total_ms
  from aigc.sync_requests
  where route in ('subject-detect','smart-select')
    and created_at >= now()-interval '7 days'
    and completed_at is not null
)
select route, scope, client_path, input_size,
  count(*) as samples,
  count(*) filter(where http_status between 200 and 299) as succeeded,
  sum(input_bytes) as input_bytes, sum(output_bytes) as response_json_bytes,
  percentile_cont(0.5) within group(order by total_ms) as p50_ms,
  percentile_cont(0.95) within group(order by total_ms) as p95_ms
from samples group by route,scope,client_path,input_size
order by route,scope,client_path,input_size;

select r.route, r.scope, s.key as stage, count(*) as samples,
  percentile_cont(0.5) within group(order by s.value::numeric) as p50_ms,
  percentile_cont(0.95) within group(order by s.value::numeric) as p95_ms
from aigc.sync_requests r
cross join lateral jsonb_each_text(r.stage_ms) s
where r.route in ('subject-detect','smart-select')
  and r.created_at >= now()-interval '7 days'
  and r.http_status between 200 and 299
group by r.route,r.scope,s.key order by r.route,r.scope,s.key;
```

第二轮决策按证据执行：若会话响应/请求字节占主导，研究会话引用和轮廓复用；若 selectionBuild 占主导，研究轮廓构建复用；若 COS 或腾讯调用占主导，评估输入准备及上传链路；若本地重复读取占主导，接入已有共享图片读取层。保留来源、样本数和失败路径，避免只看总耗时就替换协议。
