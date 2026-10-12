import assert from 'node:assert/strict'
import { database, withIdentity, runtimeScope } from '../server/db.js'
import { handleTaskCenterRoute } from '../server/task-center/route.js'
import { withTaskCenterRead } from '../server/task-center/service.js'

// 仅验收指定账号的 preview；复用应用连接，不初始化业务 schema 或修改 Auth。
if (
  process.env.TASK_CENTER_PREVIEW_CONFIRM !== 'existing_business_preview' ||
  runtimeScope() !== 'preview'
)
  throw new Error('仅允许已授权业务库 preview 验收')
const owner = process.env.TASK_CENTER_PREVIEW_USER_ID,
  other = process.env.TASK_CENTER_PREVIEW_OTHER_ID
if (
  !owner ||
  !other ||
  ![owner, other].every((id) => /^[0-9a-f-]{36}$/.test(id))
)
  throw new Error('必须指定两个已确认的测试账号')
const user = { id: owner, email: 'task-center-preview@example.invalid' }
process.env.TASK_CENTER_ENABLED = 'true'
try {
  const before = await withIdentity(
    owner,
    user.email,
    (sql) =>
      sql`select (select count(*)::int from aigc.credit_ledger) as ledger,(select jsonb_agg(to_jsonb(j)) from aigc.image_jobs j) as images,(select jsonb_agg(to_jsonb(j)) from aigc.sync_credit_jobs j) as syncs`,
  )
  const side = await handleTaskCenterRoute(
    user,
    'GET',
    ['task-center'],
    null,
    new URLSearchParams('view=sidebar'),
  )
  const history = await withTaskCenterRead(user, (repo) =>
    repo.history({ limit: 50 }),
  )
  assert.ok(history.items.length > 0, '测试账号必须已有 preview 任务')
  const task = history.items.find(
    (t) =>
      t.sourceKind === 'image_job' && t.modelProfileId === 'mock:image-stage2',
  )
  assert.ok(task, '仅选择既有 Mock 预览任务验收展示写入')
  const request = await handleTaskCenterRoute(
    user,
    'GET',
    ['task-center', 'by-request', task.sourceKind, task.requestId],
    null,
    new URLSearchParams(),
  )
  assert.ok(request)
  for (const scope of ['local', 'production']) {
    process.env.AIGC_RUNTIME_SCOPE = scope
    await assert.rejects(
      handleTaskCenterRoute(
        user,
        'GET',
        ['task-center', 'by-request', task.sourceKind, task.requestId],
        null,
        new URLSearchParams(),
      ),
      (e) => !!e && typeof e === 'object' && 'status' in e && e.status === 404,
    )
  }
  process.env.AIGC_RUNTIME_SCOPE = 'preview'
  await assert.rejects(
    handleTaskCenterRoute(
      { id: other, email: 'other-preview@example.invalid' },
      'GET',
      ['task-center', 'by-request', task.sourceKind, task.requestId],
      null,
      new URLSearchParams(),
    ),
    (e) => !!e && typeof e === 'object' && 'status' in e && e.status === 404,
  )
  if (task.outcomeVersion) {
    await handleTaskCenterRoute(
      user,
      'PATCH',
      ['task-center', task.sourceKind, task.sourceId, 'presentation'],
      { action: 'seen', outcomeVersion: task.outcomeVersion },
      new URLSearchParams(),
    )
  }
  const after = await withIdentity(
    owner,
    user.email,
    (sql) =>
      sql`select (select count(*)::int from aigc.credit_ledger) as ledger,(select jsonb_agg(to_jsonb(j)) from aigc.image_jobs j) as images,(select jsonb_agg(to_jsonb(j)) from aigc.sync_credit_jobs j) as syncs`,
  )
  assert.deepEqual(after, before)
  const permissions = await withIdentity(
    owner,
    user.email,
    (sql) =>
      sql`select current_user as role,has_table_privilege('aigc_api','aigc.sync_credit_jobs','UPDATE') as sync_write,has_table_privilege('anon','aigc.task_ui_state','SELECT') as anonymous_read`,
  )
  assert.equal(permissions[0].role, 'aigc_api')
  assert.equal(permissions[0].sync_write, false)
  assert.equal(permissions[0].anonymous_read, false)
  console.log(
    JSON.stringify(
      {
        ok: true,
        scope: 'preview',
        adapter: '实际业务库应用角色及任务中心内部路由调用，不代表已登录 HTTP 验收',
        historyCount: history.items.length,
        sidebarItems: (side as { items: unknown[] }).items.length,
        checks: [
          '集合与原请求查询成功',
          '两账号三环境隔离',
          '已查看展示写入成功',
          '原任务与账本不变',
          '同步任务 UPDATE 权限未扩大',
        ],
        httpAuthenticated: false,
      },
      null,
      2,
    ),
  )
} finally {
  await database().end()
}
