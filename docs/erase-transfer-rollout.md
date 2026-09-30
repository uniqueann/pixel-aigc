# 消除工具大图传输上线与观测

## 上线顺序

1. 对数据库执行 `20260930115938_erase_transfer_metrics.sql`，确认 `aigc.sync_requests` 新列存在。`content-up` 已于 2026-09-30 执行；其他环境仍需先迁移。新服务端的同步限流写入依赖这些列，数据库迁移必须先于服务端发布。
2. 检查私有 R2 桶的 `temporary/` 生命周期为 7 天；桶 CORS 对正式站点来源允许 `GET`、`HEAD`、`PUT`，允许请求头 `Content-Type`。具体规则见 [后端基础设施说明](backend-foundation.md#r2-设置)。预览站点如需联调，单独加入其准确来源。
3. 发布服务端和前端。对小图确认 `/api/erase` 仍直接返回 JPEG；对大图确认请求体只包含对象键，结果超过 3.5 MiB 时返回签名地址，浏览器可以直接下载。
4. 用本人账号分别测试本地上传图片、已有生成图片、无效蒙版、超 20 MB 图片、失效签名，以及大于 4.5 MB 的输出。确认请求失败时仍显示明确错误，不扣除额外积分。

## 观测

`aigc.sync_requests` 对消除请求保留 7 天，其他同步请求仍保留 2 小时。`transport` 为 `inline` 或 `object`；`stage_ms` 包含客户端准备与上传、服务端 R2 读取、百炼处理、R2 写入等阶段。`created_at` 到 `completed_at` 是服务端总耗时，不含浏览器下载结果的时间。

```sql
select date_trunc('day', created_at) as day, transport,
       count(*) as requests,
       count(*) filter (where http_status between 200 and 299) as succeeded,
       round(percentile_cont(0.5) within group (order by extract(epoch from completed_at-created_at)*1000)) as p50_server_ms,
       round(percentile_cont(0.95) within group (order by extract(epoch from completed_at-created_at)*1000)) as p95_server_ms,
       round(avg((stage_ms->>'clientUpload')::numeric)) as avg_client_upload_ms,
       round(avg((stage_ms->>'objectRead')::numeric)) as avg_r2_read_ms,
       round(avg((stage_ms->>'process')::numeric)) as avg_process_ms
from aigc.sync_requests
where route = 'erase' and created_at >= now() - interval '7 days'
  and completed_at is not null
group by 1, 2
order by 1 desc, 2;
```

对比时按 `input_bytes` 分桶，避免小图和大图的比例变化影响结论。服务端记录不包含首次页面读取原图、蒙版绘制和结果下载，完整用户等待时间需要结合浏览器网络面板核对。

## 回退

如果 R2 浏览器 GET 失败，先检查桶 CORS 与签名地址是否可达。发布回退可恢复旧前端和旧服务端；数据库新增列与 7 天清理规则可保留，不会阻止旧代码运行。超过函数请求体上限的大图在旧版本仍无法处理。
