# 任务中心故障基线与验收清单：阶段 1

| 项目 | 内容 |
| --- | --- |
| 基线 | 2026-10-11，`main` / `55c36aaa59f42ab2da8c11902bbd4946ef0ffedd` |
| 关联 | [任务契约](task-center-contract.md)、[总开发计划](task-center-development-plan.md) |
| 状态 | 文档与现有行为验证；未实施后台、接口或 UI 修复 |
| 验证结果 | 本次 11 个既有测试文件、134 个测试通过；F01/F02 在纯内存推进器复现风险 |

“既有测试通过”表示现状基线；“已复现风险”表示待修复行为；“待新增验收”是后续实现的门槛。不能把三者混写成新任务中心已经可用。

## 1. 提交、推进与积分竞争窗口

当前图片主链：创建任务及预扣事务提交 → 事务外向供应商提交 → 返回后写明细与任务编号 → 查询领取 30 秒租约 → 事务外收取结果 → 写回并结算。

| 窗口 | 可能留下的事实 | 当前风险与后续要求 |
| --- | --- | --- |
| W01 创建事务提交后，首次提交尚未落盘 | queued + pending，无供应商编号 | 原 POST 没有覆盖外部提交的领取保护；查询推进可能把 pending 当成可再次提交 |
| W02 上游接受后、供应商编号落盘前 | 数据库仍是 pending，但上游可能已开始 | 无编号不等于未发送；先记录提交意图，未知时禁止盲目重提 |
| W03 领取租约后，外部查询/下载超过租期 | 原执行者仍持有旧快照，另一执行者可重领 | 当前图片最终写回缺少视频维护器那样的有效租约约束；需要拒绝旧写回 |
| W04 对象保存后、任务结果/账本事务前 | 对象存在，原任务仍进行中 | 重试收取已有结果，不重新生成；对象与任务编号必须可安全关联 |
| W05 超时退款与迟到成功同时发生 | 同一任务已退分，但上游出现结果 | 保持原事务与幂等结算规则；图片沿用迟到结果不再收费，不能再预扣 |
| W06 同步结果保存后、同步收口前 | 临时对象可能存在，sync job 仍 reserved | 原进程继续收口或超时补偿；后台不能重新执行 erase/repaint/outpaint/bg-remove |
| W07 新查询直接复用旧 API | 打开列表触发 expire、advance 或本地资产写入 | 任务中心 GET 提取纯读取，执行维护与展示分开 |

证据：[提交及推进](../server/image-jobs/service.ts)、[图片租约领取](../server/image-jobs/repository.ts)、[事务创建](../server/image-jobs/lifecycle.ts)、[视频租约保护](../server/video-jobs/maintenance.ts)、[同步收口](../server/sync-billing.ts)。

### 供应商能力基线

| 当前适配器 | 当前结果获取 | 没有任务编号时的安全边界 |
| --- | --- | --- |
| 百炼 `bailian` | POST 返回上游编号，GET `/api/v1/tasks/:id` | 当前适配器没有接入按平台 requestId 查询或持久供应商幂等协议；待确认项不能重提 |
| DragonCode `dragoncode` | POST 返回上游编号，GET `/tasks/:id` | 同上；日志中的 upstreamRequestId 不等于可用于重提的幂等凭据 |
| OpenRouter `openrouter` | 提交请求内返回图片，暂存到按 requestId/ordinal 定位的对象，再包装为内部编号 | 有对象缓存和进程内 inflight 合并；它们不证明跨实例生成幂等。缓存未命中不能作为重新生成许可 |
| AI Gateway `ai-gateway` | 同步图片暂存、内部编号和进程内合并 | 同上；只读探测已有缓存可以作为后续补取手段，不得调用会在未命中时生成的 submit 来探测 |
| Seedance 视频 | 已有异步编号、回调及维护器 | 保留原协议，回调编号要经过鉴权查询验证；图片维护器不能重复领取视频 |

以上只说明已读源码中的接入能力，不宣称供应商在外部一定没有幂等接口。新增能力必须有官方协议或已验证实现证据；未经证实一律不允许自动补提交。Mock 没有真实账单，不能据此确认上游不会重复收费。

证据：[百炼客户端](../server/image-providers/qwen-image/client.ts)、[DragonCode 客户端](../server/image-providers/dragoncode/client.ts)、[OpenRouter 客户端](../server/image-providers/openrouter/client.ts)、[AI Gateway 客户端](../server/image-providers/ai-gateway/client.ts)、[视频维护器](../server/video-jobs/maintenance.ts)。

## 2. 故障矩阵

| 编号与触发位置 | 数据/客户端现象 | 允许动作与禁止动作 | 修复后断言及当前证据 |
| --- | --- | --- | --- |
| F01 原提交等待供应商响应，同时查询推进 | pending 无编号；两个执行者可能各自提交一次 | 必须共享领取与提交意图；禁止“无编号即重新提交” | 上游 submit=1，预扣=1；当前内存实测 submit=2，见下方脚本 |
| F02 旧查询等待响应，租约失效后新执行者推进 | 旧快照晚到并覆盖新进度 | 写回校验有效领取身份；旧执行者只能丢弃结果或交给当前执行者 | 新进度 80 不应退回 10；当前内存实测退回 10，SQL 重领条件另需数据库验收 |
| F03 上游接受后进程中止，编号未保存 | 本地待确认，服务端可能仍 pending | 查原请求；已接入幂等/对账或只读缓存探测才可补取；禁止盲目重提 | 生成请求次数不增加；未知最终按原截止规则收口；新增提交意图测试待 P1 |
| F04 未收到编号就刷新画布 | 原本地 recovery 存在，页面显示继续/放弃 | 点击继续先查原请求；找到则绑定，确认未找到的显式重放保持原幂等键；放弃不取消上游 | 原编号/请求关联不变；放弃不写取消/退款；已有恢复测试，原请求核验路径仍需补覆盖 |
| F05 提交成功后切页、刷新或关闭浏览器 | 工作站丢失内存等待；异步图片没有独立后台 | 后台推进已接受任务，重新登录后读取；禁止依赖 Assets 打开才补收结果 | 浏览器关闭时数据库与对象已经完成，查看详情前即完成；新图片后台端到端待 P1/P5 |
| F06 图片部分成功、其余失败/超时 | 可用序号不连续，任务成功且有 PARTIAL | 按原成功数结算并展示差额；禁止重排 ordinal 或自动重跑整单 | 2/4 结果身份稳定，重复读取不再结算；现有服务/账本测试通过 |
| F07 已超时退款后出现图片结果 | released/refunded 后出现可用对象 | 复用既有迟到结果规则；禁止再预扣或扣回已退积分 | 新结果版本重新提示；原账本不变；现有图片/视频迟到测试通过，新提示待 P3 |
| F08 同步工具请求中途刷新/网络失败 | sync job reserved 或 settled，本地可能没来得及保存 | 查原 billing.requestId；禁止自动再发生成 POST | 查到 settled 后读原对象，超时预留最终收口；既有 billed-sync 网络恢复测试通过 |
| F09 同步生成超过截止、或保存对象后硬停 | 对象可能孤立、sync job reserved/refunded | 查询状态和超时补偿；禁止承诺一定找回没有写进 result 的对象 | 不重复收费；后台原请求不能安全续跑时退款；孤立对象补取不纳入本期保证 |
| F10 免费抠图失败或免费额度变化 | credits_reserved=0，或服务端返回报价变化；仍有真实在线请求 | 展示真实执行记录；报价变化重新确认；禁止虚构正数扣/退分 | 免费任务可发现、零分流水可核对；已有同步计费数据库测试通过 |
| F11 签名失效、对象缺失、保留期到期 | 原任务成功，浏览器读图报错 | 重签同一对象；缺失更新可用性，优先本地字节；禁止改成生成失败或自动再生成 | 成功和账本不变；无证据的 404 不硬称 TTL 过期；新展示与真实桶策略待验收 |
| F12 集合、详情、按请求查询套用旧 API | 打开任务可能推进、超时退款或保存本地历史 | 拆纯读取，后台负责执行；禁止 GET 导致生成/结算/素材写入 | 任务中心 GET 调用供应商 submit、advance、expire 及资产写入次数均为 0；新接口待 P2 |
| F13 A 账号查询途中切到 B，或跨环境 | 旧响应、缓存、凭据可能迟到 | 取消读取并检查原 owner/scope；禁止把 A 结果应用给 B | B 无 A 的摘要/对象/正文；无权请求不暴露存在性；现有身份测试，新中心 RLS 待 P2/P3 |
| F14 原画布不存在、编辑权/未完成生成阻止切换 | task 可读，但原项目不能安全打开 | 只读详情及显式打开；使用 ProjectOpenGate；禁止覆盖/新建替代原项目 | 草稿与原项目保持可恢复；task 参数经过门禁后不丢失；现有门禁，新定位待 P4 |
| F15 同页切换任务或点击邮件 CSV 单项 | 路由未卸载，当前表单有草稿、队列有未提交项 | 响应 query 变化并保护草稿；禁止自动续跑剩余队列 | 打开任务不增加 POST，不覆盖蒙版/正文；待 P4 |
| F16 重复查看、重签、恢复部分结果 | 相同对象可能以新 URL 再次出现 | 按任务/ordinal/对象键复用；尊重本地删除记录 | 同一结果只登记一次，签名刷新不重复通知；现有资产测试，新中心待 P3/P4 |

P1 指总计划中的“服务端可靠推进”，不是本次阶段 1 文档交付。F01/F02 是图片调度上线前的必修项；其余待实现项目不因清单已写完而视为已修复。

## 3. 可重复执行的内存风险复现

以下命令仅调用现有内存仓库和 Mock 供应商，不连接数据库、不调用真实供应商、不修改业务文件。假配置只在子进程内用于通过模型选择；任何意外 fetch 都会抛错。

内存仓库用 `leases` 集合记录领取，不会自动按时间过期。F02 显式清理集合模拟 SQL 租约过期后可重新领取；它验证的是图片写回缺少保护，不是正式库并发事务已经实测。

```sh
node --import tsx --input-type=module <<'JS'
import assert from 'node:assert/strict'
import { createMemoryStore } from './server/image-jobs/memory-store.ts'
import { createMockImageProvider } from './server/image-providers/mock.ts'
import {
  createImageJobInStore, runProviderSubmits,
  advanceJobInStore, collectAdvancePatches,
} from './server/image-jobs/service.ts'

process.env.DRAGONCODE_API_KEY = 'phase-one-local-fake-key'
process.env.AIGC_RUNTIME_SCOPE = 'local'
const user = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'test@example.invalid',
}
const payload = requestId => ({
  capability: 'image_edit', requestId,
  params: {
    sourceImageKey: `temporary/task-inputs/${user.id}/fixture`,
    prompt: '测试', count: 1, resolution: '2k',
    sourceWidth: 1200, sourceHeight: 800,
  },
})
const runtime = provider => ({
  now: () => Date.now() + 10000,
  sleep: async () => {}, log: () => {},
  fetch: async () => { throw new Error('禁止真实网络') },
  signRead: async () => ({
    url: 'https://example.invalid/fixture', expiresAt: Date.now() + 900000,
  }),
  putObject: async () => {},
  billing: {
    reserve: async () => ({ ok: true }),
    settle: async () => {}, release: async () => {},
  },
  providerFor: () => provider,
})
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

// F01：原提交阻塞时，推进器看到无编号项又提交了一次。
const started = deferred(), hold = deferred()
let submits = 0
const provider = createMockImageProvider({
  submit: async () => {
    const n = ++submits
    if (n === 1) { started.resolve(); await hold.promise }
    return { providerTaskId: `fixture-${n}` }
  },
  getStatus: async () => ({ state: 'processing', progress: 25 }),
})
const store = createMemoryStore(user.id), rt = runtime(provider)
const created = await createImageJobInStore(
  store, user, payload('00000000-0000-4000-8000-000000000201'), rt,
)
const original = runProviderSubmits(created.bundle, provider, user.id, rt)
await started.promise
const job = await store.updateJob(created.bundle.job.id, { next_poll_at: new Date(0) })
await advanceJobInStore(store, { job, items: await store.listItems(job.id) }, rt)
hold.resolve()
await original
assert.equal(submits, 2)
console.log(JSON.stringify({ scenario: 'F01', observedSubmitCalls: submits, targetSubmitCalls: 1 }))

// F02：模拟过期重领，新执行者写入 80，旧执行者返回后覆盖为 10。
const oldStarted = deferred(), oldHold = deferred()
let queries = 0
const provider2 = createMockImageProvider({
  getStatus: async () => {
    if (++queries === 1) {
      oldStarted.resolve(); await oldHold.promise
      return { state: 'processing', progress: 10 }
    }
    return { state: 'processing', progress: 80 }
  },
})
const store2 = createMemoryStore(user.id), rt2 = runtime(provider2)
const created2 = await createImageJobInStore(
  store2, user, payload('00000000-0000-4000-8000-000000000202'), rt2,
)
await store2.updateItem(created2.bundle.job.id, 0, {
  status: 'processing', provider_task_id: 'fixture-accepted',
})
const oldJob = await store2.tryAcquireLease(created2.bundle.job.id, new Date(Date.now() + 30000))
assert.ok(oldJob)
const oldBundle = { job: oldJob, items: await store2.listItems(oldJob.id) }
const oldOutcomes = collectAdvancePatches(oldJob, oldBundle.items, rt2)
await oldStarted.promise
await store2.updateJob(oldJob.id, { lease_until: new Date(Date.now() - 1000) })
store2.leases.delete(oldJob.id)
const newJob = await store2.tryAcquireLease(oldJob.id, new Date(Date.now() + 60000))
assert.ok(newJob)
const newBundle = { job: newJob, items: await store2.listItems(newJob.id) }
await advanceJobInStore(store2, newBundle, rt2, {
  alreadyLeased: true,
  outcomes: await collectAdvancePatches(newJob, newBundle.items, rt2),
})
assert.equal((await store2.listItems(oldJob.id))[0].progress, 80)
oldHold.resolve()
await advanceJobInStore(store2, oldBundle, rt2, {
  alreadyLeased: true, outcomes: await oldOutcomes,
})
const progress = (await store2.listItems(oldJob.id))[0].progress
assert.equal(progress, 10)
console.log(JSON.stringify({
  scenario: 'F02', progressAfterNewWriter: 80,
  progressAfterOldWriter: progress, targetProgress: 80,
}))
JS
```

当前预期输出：F01 `observedSubmitCalls=2`；F02 `progressAfterOldWriter=10`。命令的断言确认风险存在，退出码 0 不表示安全修复完成。P1 修复后改为提交次数 1、旧写回被拒绝且进度保持 80，并增加真实数据库租约/并发测试；不能长期把风险复现当作通过门槛。

## 4. 本次既有行为验证

执行以下命令，结果为 11 个文件、134 个测试通过，退出码 0，末尾无 `Unhandled Errors`：

```sh
npm test -- \
  server/image-jobs/service.test.ts \
  server/image-jobs/billing.database.test.ts \
  server/sync-billing.test.ts \
  server/payments/billing.database.test.ts \
  server/email-billing.database.test.ts \
  server/video-jobs/service.test.ts \
  server/video-jobs/database.test.ts \
  src/services/api/billed-sync.test.ts \
  src/features/free-canvas/generation/useFreeCanvasGenerationController.test.tsx \
  src/pages/Toolbox/bg-remove/history.test.ts \
  src/features/assets/hydrateImageJobs.test.ts
```

覆盖证据：

- 图片状态归约、超时映射、部分成功、迟到结果与既有账本结算。
- 同步计费复用、免费抠图零分流水、余额/环境隔离；客户端网络错误只查询原请求。
- 邮件事务创建、超时退款、迟到结果、原请求凭据和环境隔离。
- 视频结果转存、租约领取、迟到结果、清理与账本路径。
- 画布本地恢复、占位结果应用、抠图成功队列恢复与资产补记去重。

数据库测试使用项目现有本地测试基础，浏览器行为使用模拟组件/对象。此命令没有完成正式供应商扣费、R2 生命周期、正式站浏览器关闭或新任务中心接口验证。本阶段只有文档变更，不运行与之无关的打包/全量样式回归，也不新增契约代码测试文件。

## 5. 阶段退出与后续门槛

| 验收项 | 阶段 1 结论 |
| --- | --- |
| 在线任务源、真实请求编号、结果路径与免费分支 | 已核对，见契约登记表 |
| 执行、积分、结果三个维度与客户端状态 | 已冻结映射与样例，新增适配器待 P2 |
| 提交未知时的允许/禁止动作 | 已冻结，未证实上游能力默认禁止自动补提交 |
| 提交/租约竞争窗口 | 已记录 W01–W07，F01/F02 已内存复现 |
| 原接口读取副作用 | 已列出，后续只读接口必须拆开 expire/advance/hydration |
| 保留期限与证据 | 已区分记录/对象/签名/本机字节；R2 正式桶策略待 P5 实查 |
| 草稿、画布门禁、批量未提交项边界 | 已确定不覆盖、不自动执行的恢复规则 |
| 基线测试与可重复验证 | 134 项既有测试通过；故障脚本可重复运行，数据库重领部分明确为模拟 |

下一阶段先实施图片提交意图、共享领取、有效租约写回与幂等收口，然后启用后台调度。F01/F02 未通过修复后的断言前，禁止把图片分钟工作器上线作为已完成恢复能力。后续新接口/页面的测试必须直接覆盖此矩阵，现有绿色基线不能代替新增验收。
