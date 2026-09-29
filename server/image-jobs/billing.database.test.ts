import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import type { Transaction } from '../db'
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
  ]) await db.exec(readFileSync(`supabase/migrations/${file}`, 'utf8'))
  await db.query('insert into aigc.members(user_id) values($1)', [userId])
}, 30000)

afterAll(async () => {
  if (previousScope === undefined) delete process.env.AIGC_RUNTIME_SCOPE
  else process.env.AIGC_RUNTIME_SCOPE = previousScope
  await db.close()
})

describe('积分账本与同步请求限流', () => {
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
        .rejects.toMatchObject({ status: 429, code: 'USER_CONCURRENCY' })
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
        .rejects.toMatchObject({ status: 429, code: 'RATE_LIMIT' })
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
})
