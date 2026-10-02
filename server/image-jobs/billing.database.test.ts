import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { Transaction } from '../db'
import { listCreditLedger } from '../credits'
import { acquireSyncRequest } from '../sync-limits'
import { createSqlBilling, ensureCreditAccount } from './billing'

const userId = '00000000-0000-4000-8000-000000000011'
let db: PGlite
const previousScope = process.env.AIGC_RUNTIME_SCOPE

function transactionTag(): Transaction {
  const tagged = Object.assign(
    (parts: TemplateStringsArray, ...values: unknown[]) => {
      const query = parts.reduce((text, part, index) => text + (index ? `$${index}` : '') + part, '')
      return db.query(query, values as never[]).then(result => result.rows)
    },
    { json: (value: unknown) => JSON.stringify(value) },
  )
  return tagged as unknown as Transaction
}

async function asUser<T>(action: (sql: Transaction) => Promise<T>, scope = 'production') {
  process.env.AIGC_RUNTIME_SCOPE = scope
  await db.exec('begin; set local role aigc_api;')
  try {
    await db.query("select set_config('aigc.user_id',$1,true),set_config('aigc.scope',$2,true)", [userId, scope])
    const result = await action(transactionTag())
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}

async function insertJob(sql: Transaction, id: string, reserved: number, count = 2) {
  await sql`insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,
    provider,params,provider_params,requested_count,status,credits_reserved,billing_state,deadline_at)
    values(${id},${userId},'production',${randomUUID()},'hash','image_edit','dragoncode:gpt-image-2',
      'dragoncode','{}','{}',${count},'processing',${reserved},'reserved',now()+interval '5 minutes')`
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key); insert into auth.users values('${userId}');`)
  for (const file of [
    '20260908094310_aigc_foundation.sql',
    '20260923015953_aigc_accounts.sql',
    '20260923020155_aigc_project_compat.sql',
    '20260923102829_aigc_email_byok.sql',
    '20260928120000_aigc_image_jobs.sql',
    '20260929100000_aigc_credits_and_sync_limits.sql',
    '20260929233436_aigc_credit_adjust.sql',
    '20260930115938_erase_transfer_metrics.sql',
    '20260930234407_sync_image_transfer_retention.sql',
    '20261001120433_bg_remove_transfer_retention.sql',
    '20261002031941_detection_metrics_retention.sql',
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query('insert into aigc.members(user_id) values($1)', [userId])
}, 30000)

afterAll(async () => {
  if (previousScope === undefined) delete process.env.AIGC_RUNTIME_SCOPE
  else process.env.AIGC_RUNTIME_SCOPE = previousScope
  await db.close()
})

describe('积分账本与同步请求限流', () => {
  it('主体检测和智能选区保留七天，旧检测记录和未知路由仍清理', async () => {
    const ids: string[] = []
    for (const route of ['subject-detect', 'smart-select']) {
      for (const days of [3, 8]) {
        const id = randomUUID(); ids.push(id)
        await asUser(sql => sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route)
          values(${id},${userId},'production','detection',now()-interval '1 minute',now(),now()-${days}*interval '1 day',${route})`)
      }
    }
    const unknown = randomUUID()
    await asUser(async sql => {
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,created_at,route)
        values(${unknown},${userId},'production','detection',now()-interval '3 hours',now()-interval '3 hours','unknown')`
      await sql`select aigc.purge_expired_sync_requests()`
    })
    const rows = await db.query<{ id: string }>('select id from aigc.sync_requests where id=any($1::uuid[])', [[...ids, unknown]])
    expect(rows.rows.map(row => row.id).sort()).toEqual([ids[0], ids[2]].sort())
  })
  it('四种同步图像工具的性能记录保留七天，其他同步记录仍按两小时清理', async () => {
    const recentErase = randomUUID()
    const recentRepaint = randomUUID()
    const recentOutpaint = randomUUID()
    const oldErase = randomUUID()
    const oldOther = randomUUID()
    const recentMatting = randomUUID()
    const oldMatting = randomUUID()
    await asUser(async sql => {
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route,transport,stage_ms)
        values(${recentErase},${userId},'production','generation',now()-interval '3 days',now()-interval '3 days',now()-interval '3 days','erase','object',${sql.json({ process: 1234 })})`
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route)
        values(${oldErase},${userId},'production','generation',now()-interval '8 days',now()-interval '8 days',now()-interval '8 days','erase')`
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route)
        values(${recentRepaint},${userId},'production','generation',now()-interval '3 days',now()-interval '3 days',now()-interval '3 days','repaint')`
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route)
        values(${recentOutpaint},${userId},'production','generation',now()-interval '3 days',now()-interval '3 days',now()-interval '3 days','outpaint')`
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at)
        values(${oldOther},${userId},'production','generation',now()-interval '3 hours',now()-interval '3 hours',now()-interval '3 hours')`
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route)
        values(${recentMatting},${userId},'production','detection',now()-interval '3 days',now()-interval '3 days',now()-interval '3 days','bg-remove')`
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at,created_at,route)
        values(${oldMatting},${userId},'production','detection',now()-interval '8 days',now()-interval '8 days',now()-interval '8 days','bg-remove')`
      await sql`select aigc.purge_expired_sync_requests()`
    })
    const rows = await db.query('select id,stage_ms from aigc.sync_requests where id in ($1,$2,$3,$4,$5,$6,$7) order by id',
      [recentErase, recentRepaint, recentOutpaint, oldErase, oldOther, recentMatting, oldMatting])
    expect(rows.rows).toEqual([
      { id: recentErase, stage_ms: { process: 1234 } },
      { id: recentRepaint, stage_ms: {} },
      { id: recentOutpaint, stage_ms: {} },
      { id: recentMatting, stage_ms: {} },
    ].sort((a, b) => a.id.localeCompare(b.id)))
  })

  it('首次发放幂等，且不同环境有独立余额', async () => {
    expect(await asUser(sql => ensureCreditAccount(sql, userId))).toBe(100)
    expect(await asUser(sql => ensureCreditAccount(sql, userId))).toBe(100)
    expect(await asUser(sql => ensureCreditAccount(sql, userId), 'preview')).toBe(100)
    const rows = await db.query("select scope,count(*)::integer as count from aigc.credit_ledger where kind='grant' group by scope")
    expect(rows.rows).toEqual(expect.arrayContaining([{ scope: 'production', count: 1 }, { scope: 'preview', count: 1 }]))
  })

  it('运行角色不能直接改余额或流水，也不能代他人初始化', async () => {
    await expect(asUser(sql => sql`update aigc.credit_accounts set balance=999 where user_id=${userId}`))
      .rejects.toThrow()
    await expect(asUser(sql => sql`insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key)
      values(${userId},'production','grant',999,999,'forged')`)).rejects.toThrow()
    await expect(asUser(sql => ensureCreditAccount(sql, randomUUID()))).rejects.toThrow()
  })

  it('预扣与结算只记一次，并按成功张数退差额', async () => {
    const id = randomUUID()
    await asUser(async sql => {
      const billing = createSqlBilling(sql)
      expect(await billing.reserve({ userId, jobId: id, amount: 6, meta: { resolution: '2k' } })).toEqual({ ok: true })
      await insertJob(sql, id, 6)
    })
    await asUser(async sql => {
      const billing = createSqlBilling(sql)
      await billing.settle({ jobId: id, charged: 3 })
      await billing.settle({ jobId: id, charged: 3 })
    })
    const account = await db.query<{ balance: number }>("select balance from aigc.credit_accounts where user_id=$1 and scope='production'", [userId])
    expect(account.rows[0].balance).toBe(97)
    const ledger = await db.query<{ kind: string; delta: number }>('select kind,delta from aigc.credit_ledger where job_id=$1 order by created_at', [id])
    expect(ledger.rows).toEqual([{ kind: 'reserve', delta: -6 }, { kind: 'settle', delta: 3 }])
  })

  it('余额不足不创建预扣流水，事务失败会回滚预扣', async () => {
    const short = await asUser(sql => createSqlBilling(sql).reserve({ userId, jobId: randomUUID(), amount: 101, meta: {} }))
    expect(short).toMatchObject({
      ok: false,
      code: 'INSUFFICIENT_CREDITS',
      required: 101,
      balance: 97,
      message: '积分余额不足：本次需要 101 积分，当前余额 97',
    })
    await expect(asUser(async sql => {
      await createSqlBilling(sql).reserve({ userId, jobId: randomUUID(), amount: 2, meta: {} })
      throw new Error('模拟任务创建失败')
    })).rejects.toThrow('模拟任务创建失败')
    const balance = await db.query<{ balance: number }>("select balance from aigc.credit_accounts where user_id=$1 and scope='production'", [userId])
    expect(balance.rows[0].balance).toBe(97)
  })

  it('同一任务不能以不同金额重复预扣', async () => {
    const id = randomUUID()
    await expect(asUser(async sql => {
      const billing = createSqlBilling(sql)
      await billing.reserve({ userId, jobId: id, amount: 2, meta: {} })
      await billing.reserve({ userId, jobId: id, amount: 3, meta: {} })
    })).rejects.toThrow('任务预扣金额冲突')
    const ledger = await db.query('select id from aigc.credit_ledger where job_id=$1', [id])
    expect(ledger.rows).toHaveLength(0)
  })

  it('超时清扫结算已成功的一张，退回未完成的一张', async () => {
    const id = randomUUID()
    await asUser(async sql => {
      await createSqlBilling(sql).reserve({ userId, jobId: id, amount: 6, meta: {} })
      await insertJob(sql, id, 6)
      await sql`update aigc.image_jobs set deadline_at=now()-interval '1 minute' where id=${id}`
      await sql`insert into aigc.image_job_items(job_id,ordinal,user_id,scope,status)
        values(${id},0,${userId},'production','succeeded'),(${id},1,${userId},'production','submitted')`
      await sql`select aigc.expire_overdue_image_jobs(${userId})`
    })
    const job = await db.query<{ status: string; billing_state: string; credits_charged: number }>('select status,billing_state,credits_charged from aigc.image_jobs where id=$1', [id])
    expect(job.rows[0]).toMatchObject({ status: 'succeeded', billing_state: 'settled', credits_charged: 3 })
    const balance = await db.query<{ balance: number }>("select balance from aigc.credit_accounts where user_id=$1 and scope='production'", [userId])
    expect(balance.rows[0].balance).toBe(94)
  })

  it('整单失败全额退还，重复退款不再改变余额', async () => {
    const id = randomUUID()
    await asUser(async sql => {
      const billing = createSqlBilling(sql)
      await billing.reserve({ userId, jobId: id, amount: 5, meta: {} })
      await insertJob(sql, id, 5, 1)
      await billing.release(id)
      await billing.release(id)
    })
    const balance = await db.query<{ balance: number }>("select balance from aigc.credit_accounts where user_id=$1 and scope='production'", [userId])
    expect(balance.rows[0].balance).toBe(94)
    const ledger = await db.query<{ kind: string; delta: number }>('select kind,delta from aigc.credit_ledger where job_id=$1 order by created_at', [id])
    expect(ledger.rows).toEqual([{ kind: 'reserve', delta: -5 }, { kind: 'refund', delta: 5 }])
  })

  it('定时清扫入口可以不传用户参数调用', async () => {
    const result = await db.query<{ expired: number }>('select aigc.expire_overdue_image_jobs() as expired')
    expect(Number(result.rows[0].expired)).toBe(0)
  })

  it('同步图片操作执行并发限制，释放名额后可以继续', async () => {
    const ids = [randomUUID(), randomUUID(), randomUUID()]
    await asUser(async sql => {
      await acquireSyncRequest(sql, userId, 'production', 'generation', ids[0])
      await acquireSyncRequest(sql, userId, 'production', 'generation', ids[1])
      await expect(acquireSyncRequest(sql, userId, 'production', 'generation', ids[2]))
        .rejects.toMatchObject({
          status: 429,
          code: 'USER_CONCURRENCY',
          message: '该类图片操作正在处理中，请等待当前任务完成',
          extra: { retryAfterSeconds: 5 },
        })
    })
    await asUser(async sql => {
      await sql`update aigc.sync_requests set completed_at=now() where id=${ids[0]}`
      await acquireSyncRequest(sql, userId, 'production', 'generation', ids[2])
    })
  })

  it('同步图片操作达到小时额度后返回 429', async () => {
    await asUser(async sql => {
      await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,completed_at)
        select gen_random_uuid(),${userId},'production','detection',now(),now() from generate_series(1,59)`
      const last = randomUUID()
      await acquireSyncRequest(sql, userId, 'production', 'detection', last)
      await sql`update aigc.sync_requests set completed_at=now() where id=${last}`
      await expect(acquireSyncRequest(sql, userId, 'production', 'detection', randomUUID()))
        .rejects.toMatchObject({
          status: 429,
          code: 'RATE_LIMIT',
          message: expect.stringMatching(/约 \d+ 分钟后可再试/),
          extra: { retryAfterSeconds: expect.any(Number) },
        })
    })
  })

  it('管理员调整可把余额设为 0，且不会低于 0，同一幂等键不再改', async () => {
    const first = await db.query<{ balance: number }>(
      "select aigc.adjust_credits($1,'production','set',0,'管理员','测 402','set-zero-1') as balance",
      [userId],
    )
    expect(Number(first.rows[0].balance)).toBe(0)
    const again = await db.query<{ balance: number }>(
      "select aigc.adjust_credits($1,'production','set',0,'管理员','测 402','set-zero-1') as balance",
      [userId],
    )
    expect(Number(again.rows[0].balance)).toBe(0)
    await db.query(
      "select aigc.adjust_credits($1,'production','delta',-20,'管理员','再扣','deduct-1') as balance",
      [userId],
    )
    const account = await db.query<{ balance: number }>("select balance from aigc.credit_accounts where user_id=$1 and scope='production'", [userId])
    expect(account.rows[0].balance).toBe(0)
    const restored = await db.query<{ balance: number }>(
      "select aigc.adjust_credits($1,'production','set',100,'管理员','恢复','restore-100-1') as balance",
      [userId],
    )
    expect(Number(restored.rows[0].balance)).toBe(100)
    await expect(asUser(sql => sql`select aigc.adjust_credits(${userId},'production','set',0,'管理员','越权','x')`))
      .rejects.toThrow()
    const ledger = await db.query<{ kind: string; delta: number }>(
      "select kind,delta from aigc.credit_ledger where idempotency_key like 'admin:%' and user_id=$1 order by created_at",
      [userId],
    )
    expect(ledger.rows).toEqual([
      { kind: 'adjust', delta: -94 },
      { kind: 'adjust', delta: 0 },
      { kind: 'adjust', delta: 100 },
    ])
  })

  it('积分明细把同一任务的预扣和结算收成一行', async () => {
    const id = randomUUID()
    const page = await asUser(async sql => {
      const billing = createSqlBilling(sql)
      await billing.reserve({
        userId, jobId: id, amount: 2,
        meta: { capability: 'image_edit', resolution: '1k', unitPrice: 2 },
      })
      await insertJob(sql, id, 2, 1)
      await billing.settle({ jobId: id, charged: 2 })
      return listCreditLedger(sql, null, 50)
    })
    const merged = page.items.find(item => item.summary === '实扣 2' && item.delta === -2)
    expect(merged).toMatchObject({ label: '智能编辑 1K×1', deltaText: '-2' })
    expect(page.items.filter(item => item.id === merged?.id)).toHaveLength(1)
    expect(page.items.some(item => item.label === '提交预扣' && item.summary.includes('1K×1'))).toBe(false)
  })

  it('积分明细分页按任务成组，不会把同一 job 拆到两页', async () => {
    const jobId = randomUUID()
    await asUser(async sql => {
      const billing = createSqlBilling(sql)
      await billing.reserve({
        userId, jobId, amount: 6,
        meta: { capability: 'image_edit', resolution: '2k', unitPrice: 3 },
      })
      await insertJob(sql, jobId, 6, 2)
      await billing.settle({ jobId, charged: 3 })
    })
    for (let i = 0; i < 19; i += 1) {
      await db.query(
        `insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,idempotency_key,reason)
         values($1,'production','grant',0,100,$2,$3)`,
        [userId, `pad-key-${i}`, `pad-${i}`],
      )
    }
    const page = await asUser(sql => listCreditLedger(sql, null, 20))
    const jobRow = page.items.find(item => item.summary === '实扣 3, 已退回 3')
    expect(jobRow).toMatchObject({ delta: -3, deltaText: '-3' })
    expect(page.items.filter(item => item.summary.includes('预扣') && item.label.includes('2K'))).toHaveLength(0)
    expect(page.nextCursor).toBeTruthy()
    const next = await asUser(sql => listCreditLedger(sql, page.nextCursor, 20))
    expect(next.items.some(item => item.id === jobRow?.id)).toBe(false)
    expect(next.items.filter(item => item.summary.includes('预扣') && item.label.includes('2K'))).toHaveLength(0)
  })
})
