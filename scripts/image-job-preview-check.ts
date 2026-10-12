import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { database, withIdentity } from '../server/db.js'
import { requireActive } from '../server/members.js'
import { createSqlBilling } from '../server/image-jobs/billing.js'
import { createSqlStore } from '../server/image-jobs/repository.js'
import { createImageJobInStore, createImageTaskSchema, defaultImageJobRuntime } from '../server/image-jobs/service.js'

// 业务库只创建一项真实协议的 preview Mock 任务，不初始化 schema，不修改 Auth 或生产积分。
if (process.env.AIGC_RUNTIME_SCOPE !== 'preview' || process.env.IMAGE_PREVIEW_VERIFY_CONFIRM !== 'existing_business_preview') {
  throw new Error('必须显式指定 preview 和 IMAGE_PREVIEW_VERIFY_CONFIRM=existing_business_preview')
}
const reportPath = process.env.IMAGE_PREVIEW_REPORT_PATH
if (!reportPath) throw new Error('必须指定私有临时报告路径 IMAGE_PREVIEW_REPORT_PATH')
const action = process.argv[2]
if (action !== 'create' && action !== 'check') throw new Error('操作只允许 create/check')

try {
  if (action === 'create') {
    if (process.env.AIGC_IMAGE_MOCK_PROVIDER !== 'true') throw new Error('预览验收必须使用 Mock')
    // 管理员先确认现有预览测试账号；应用连接只使用该账号的 RLS 身份，不读取 Auth。
    const userId = process.env.IMAGE_PREVIEW_USER_ID
    if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) throw new Error('必须指定已确认的 IMAGE_PREVIEW_USER_ID')
    const email = 'stage2-preview@example.invalid'
    const requestId = randomUUID()
    const created = await withIdentity(userId, email, async sql => {
      await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
      await requireActive(sql, userId)
      await sql`select pg_advisory_xact_lock(91517002)`
      const store = createSqlStore(sql, userId)
      const result = await createImageJobInStore(store, {
        id: userId, email, suggestedName: '预览验收', avatarUrl: null, providers: ['email'],
      }, createImageTaskSchema.parse({ capability: 'text_to_image', requestId,
        modelProfileId: 'mock:image-stage2',
        params: { prompt: '后台可靠推进验收', count: 1, resolution: '1k', size: { width: 1024, height: 1024 } },
      }), { ...defaultImageJobRuntime(), billing: createSqlBilling(sql), log: () => undefined })
      // 模拟创建已提交、原进程尚未发送就中止。仅 not_sent 允许后台安全补提交。
      assert.ok(await store.assertLease(result.bundle.job.id, result.bundle.job.lease_token!))
      await store.updateJob(result.bundle.job.id, {
        lease_token: null, lease_until: null, lease_owner: null, next_poll_at: new Date(),
      })
      return result.bundle.job.id
    })
    const report = { jobId: created, requestId, userId, scope: 'preview',
      createdAt: new Date().toISOString(), supplier: 'Mock', userTaskGetCalls: 0 }
    writeFileSync(reportPath, JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(JSON.stringify({ jobId: created, requestId, scope: 'preview', userTaskGetCalls: 0 }))
  } else {
    const fixture = JSON.parse(readFileSync(reportPath, 'utf8')) as {
      jobId: string; requestId: string; userId: string; scope: string; createdAt: string
    }
    assert.equal(fixture.scope, 'preview')
    const result = await withIdentity(fixture.userId, 'stage2-preview@example.invalid', async sql => {
      const [job] = await sql`select id,scope,status,billing_state,credits_charged from aigc.image_jobs
        where id=${fixture.jobId} and user_id=${fixture.userId} and scope='preview' and model_profile_id='mock:image-stage2'`
      assert.ok(job)
      const items = await sql`select status,result_object_key,result_width,result_height from aigc.image_job_items
        where job_id=${fixture.jobId} and scope='preview' order by ordinal`
      const attempts = await sql`select kind,outcome,checksum from aigc.image_job_attempts
        where job_id=${fixture.jobId} and scope='preview' order by created_at`
      const ledger = await sql`select scope,kind,delta,charged from aigc.credit_ledger where job_id=${fixture.jobId} order by created_at`
      return { job,items,attempts,ledger }
    })
    const { job,items,attempts,ledger } = result
    const completed = job.status === 'succeeded' && job.billing_state === 'settled'
    if (completed) {
      assert.equal(job.credits_charged, 1)
      assert.equal(items.length, 1)
      assert.equal(items[0].status, 'succeeded')
      assert.ok(String(items[0].result_object_key).startsWith(`generated/${fixture.userId}/preview/${fixture.jobId}/`))
      assert.equal(attempts.filter(attempt => attempt.kind === 'submit').length, 1)
      assert.equal(attempts.filter(attempt => attempt.kind === 'submit' && attempt.outcome === 'accepted').length, 1)
      assert.equal(attempts.filter(attempt => attempt.kind === 'transfer' && /^[a-f0-9]{64}$/.test(String(attempt.checksum))).length, 1)
      assert.equal(ledger.filter(entry => entry.kind === 'reserve').length, 1)
      assert.equal(ledger.filter(entry => entry.kind === 'settle').length, 1)
      assert.equal(ledger.filter(entry => entry.kind === 'refund').length, 0)
    }
    assert.ok(ledger.every(entry => entry.scope === 'preview'))
    const report = { checkedAt: new Date().toISOString(), jobId: fixture.jobId, requestId: fixture.requestId,
      scope: 'preview', completed, status: job.status, billingState: job.billing_state, charged: job.credits_charged,
      submitAttempts: attempts.filter(attempt => attempt.kind === 'submit').length,
      transferAttempts: attempts.filter(attempt => attempt.kind === 'transfer').length,
      reserveEntries: ledger.filter(entry => entry.kind === 'reserve').length,
      settleEntries: ledger.filter(entry => entry.kind === 'settle').length,
      userTaskGetCalls: 0,
      supplier: 'Mock', storage: '部署实际 R2（完成状态仅在 PUT 成功后发布）',
    }
    console.log(JSON.stringify(report, null, 2))
  }
} finally {
  await database().end()
}
