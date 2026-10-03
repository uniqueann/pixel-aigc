import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { SEEDANCE_VIDEO_MODEL } from '../../shared/video-models.js'
import type { Transaction } from '../db.js'

const mocks = vi.hoisted(() => ({ identity: vi.fn(), database: vi.fn(), remove: vi.fn() }))
vi.mock('../db.js', () => ({ withIdentity: mocks.identity, database: mocks.database, runtimeScope: () => process.env.AIGC_RUNTIME_SCOPE ?? 'production' }))
vi.mock('../storage.js', async original => ({ ...await original<typeof import('../storage.js')>(), deleteObject: mocks.remove }))
import { createSqlStore } from '../image-jobs/repository.js'
import { createSqlBilling } from '../image-jobs/billing.js'
import { defaultVideoJobRuntime, createVideoTaskSchema, createVideoJobInStore, applyVideoSubmission } from './service.js'
import { maintainVideoJobs, recordVideoCallback } from './maintenance.js'
import { callbackToken } from '../video-providers/seedance/config.js'
import { signOwnedObjectRead, loadOwnedObject } from '../objects.js'

const users = ['00000000-0000-4000-8000-000000000011', '00000000-0000-4000-8000-000000000022']
let db: PGlite
interface Fragment { query: string; values: unknown[]; then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => Promise<unknown> }
type Query = (query: string, values: never[]) => Promise<{ rows: unknown[] }>

// 测试桥接支持 postgres.js 的嵌套 SQL 片段，真正执行迁移、RLS 和账本函数。
function tag(query: Query): Transaction {
  const sql = (parts: TemplateStringsArray, ...values: unknown[]) => {
    let text = parts[0]
    const bound: unknown[] = []
    values.forEach((value, index) => {
      if (value && typeof value === 'object' && 'query' in value && 'values' in value) {
        const fragment = value as Fragment
        text += fragment.query.replace(/\$(\d+)/g, (_, number) => `$${Number(number) + bound.length}`)
        bound.push(...fragment.values)
      } else { bound.push(value); text += `$${bound.length}` }
      text += parts[index + 1]
    })
    return { query: text, values: bound, then: (resolve, reject) => query(text, bound as never[]).then(result => result.rows).then(resolve, reject) } satisfies Fragment
  }
  return Object.assign(sql, { json: (value: unknown) => JSON.stringify(value) }) as unknown as Transaction
}
async function identity<T>(id: string, scope: string, action: (sql: Transaction) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.exec('set local role aigc_api')
    await tx.query("select set_config('aigc.user_id',$1,true),set_config('aigc.email','',true),set_config('aigc.scope',$2,true)", [id, scope])
    return action(tag((text, values) => tx.query(text, values)))
  })
}
function runtime() {
  return { ...defaultVideoJobRuntime(), log: vi.fn(), writeVideo: vi.fn(async () => {}),
    videoProvider: { id: 'seedance' as const, submit: vi.fn(async () => ({ providerTaskId: 'cgt-test' })),
      getStatus: vi.fn(async () => ({ state: 'succeeded' as const, model: SEEDANCE_VIDEO_MODEL.model, videoUrl: 'https://a.volces.com/v.mp4' })),
      fetchResult: vi.fn(async () => readFileSync('public/mock/text-to-video-5s.mp4')) },
    callbackUrl: () => 'https://example.test/callback',
    signRead: vi.fn(async (key: string, ttl = 900) => ({ url: `https://r2.test/${key}`, expiresAt: Date.now() + ttl * 1000 })),
  }
}
async function create(id = users[0], scope = 'production', requestId = randomUUID()) {
  vi.stubEnv('AIGC_RUNTIME_SCOPE', scope)
  const rt = runtime()
  const request = createVideoTaskSchema.parse({ capability: 'text_to_video', requestId, priceVersion: SEEDANCE_VIDEO_MODEL.pricing.version,
    params: { mode: 'text_to_video', prompt: '雨夜城市', count: 1, size: { width: 1280, height: 720 }, ratio: '16:9', resolution: '720p', durationSeconds: 5 } })
  return identity(id, scope, async sql => createVideoJobInStore(createSqlStore(sql, id, 'video'), { id }, request, { ...rt, billing: createSqlBilling(sql) }))
}
async function callback(jobId: string, id = 'cgt-test') {
  return recordVideoCallback(new URLSearchParams({ jobId, scope: 'production', token: callbackToken(jobId, 'production') }), { id, status: 'succeeded' })
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    insert into auth.users values('${users[0]}'),('${users[1]}');`)
  for (const name of ['20260908094310_aigc_foundation.sql', '20260923015953_aigc_accounts.sql', '20260923020155_aigc_project_compat.sql',
    '20260923102829_aigc_email_byok.sql', '20260928120000_aigc_image_jobs.sql', '20260929100000_aigc_credits_and_sync_limits.sql',
    '20260929233436_aigc_credit_adjust.sql', '20261003080118_aigc_seedance_video_jobs.sql']) {
    await db.exec(readFileSync(`supabase/migrations/${name}`, 'utf8'))
  }
  for (const id of users) await db.query('insert into aigc.members(user_id) values($1)', [id])
  mocks.identity.mockImplementation((id, _email, action) => identity(id, process.env.AIGC_RUNTIME_SCOPE ?? 'production', action))
  mocks.database.mockReturnValue({ begin: (action: (sql: Transaction) => Promise<unknown>) => db.transaction(tx => action(tag((text, values) => tx.query(text, values)))) })
}, 30000)
beforeEach(async () => {
  vi.stubEnv('AIGC_RUNTIME_SCOPE', 'production')
  vi.stubEnv('SEEDANCE_CALLBACK_SECRET', '测试回调签名密钥')
  mocks.remove.mockReset().mockResolvedValue(undefined)
  await db.exec('truncate aigc.image_jobs,aigc.credit_ledger,aigc.credit_accounts cascade')
  for (const id of users) for (const scope of ['production', 'preview'])
    await db.query('insert into aigc.credit_accounts(user_id,scope,balance) values($1,$2,1000)', [id, scope])
})
afterEach(() => vi.unstubAllEnvs())
afterAll(async () => { await db.close() })

describe('视频数据库状态机与隔离', () => {
  it('同一请求只预扣一次，两个账号和两个环境分别保存任务与余额', async () => {
    const request = randomUUID()
    const a = await create(users[0], 'production', request)
    const repeated = await create(users[0], 'production', request)
    const b = await create(users[1], 'production', request)
    const preview = await create(users[0], 'preview', request)
    expect(repeated.created).toBe(false)
    expect(new Set([a.bundle.job.id, b.bundle.job.id, preview.bundle.job.id]).size).toBe(3)
    const rows = await db.query('select scope,user_id,balance from aigc.credit_accounts where balance<>1000')
    expect(rows.rows).toHaveLength(3)
    expect(rows.rows.every(row => (row as { balance: number }).balance === 950)).toBe(true)
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'production')
    expect(await identity(users[1], 'production', sql => createSqlStore(sql, users[1], 'video').findById(a.bundle.job.id))).toBeUndefined()
    const ledger = await db.query('select kind,delta from aigc.credit_ledger where job_id=$1', [a.bundle.job.id])
    expect(ledger.rows).toEqual([{ kind: 'reserve', delta: -50 }])
  })
  it('任务创建失败时事务回滚积分，独立视频额度不占图片额度', async () => {
    await expect(identity(users[0], 'production', async sql => {
      await createSqlBilling(sql).reserve({ userId: users[0], jobId: randomUUID(), amount: 50, meta: {} })
      throw new Error('模拟写入失败')
    })).rejects.toThrow('模拟写入失败')
    await create()
    await identity(users[0], 'production', async sql => {
      expect(await createSqlStore(sql, users[0]).hourlyCount()).toBe(0)
      expect(await createSqlStore(sql, users[0]).globalActiveCount()).toBe(0)
      expect(await createSqlStore(sql, users[0], 'video').globalActiveCount()).toBe(1)
    })
    await expect(create()).rejects.toMatchObject({ code: 'USER_CONCURRENCY' })
  })
  it('重复回调只提示待核实状态，后台转存后共用账本结算一次', async () => {
    const { bundle } = await create(), rt = runtime()
    await callback(bundle.job.id)
    await callback(bundle.job.id)
    expect((await db.query('select status from aigc.image_jobs where id=$1', [bundle.job.id])).rows).toEqual([{ status: 'queued' }])
    await maintainVideoJobs(bundle.job.id, rt)
    await callback(bundle.job.id)
    await maintainVideoJobs(bundle.job.id, rt)
    const job = await db.query('select status,billing_state,credits_charged,expires_at,completed_at from aigc.image_jobs where id=$1', [bundle.job.id])
    expect(job.rows[0]).toMatchObject({ status: 'succeeded', billing_state: 'settled', credits_charged: 50 })
    expect(rt.writeVideo).toHaveBeenCalledTimes(1)
    expect((await db.query('select kind,delta from aigc.credit_ledger where job_id=$1 order by created_at', [bundle.job.id])).rows)
      .toEqual([{ kind: 'reserve', delta: -50 }, { kind: 'settle', delta: 0 }])
  })
  it('无浏览器轮询也会超时退款，截止后收到回调的结果免费补回', async () => {
    const { bundle } = await create(), rt = runtime()
    await db.query("update aigc.image_jobs set deadline_at=now()-interval '1 minute' where id=$1", [bundle.job.id])
    await maintainVideoJobs(bundle.job.id, rt)
    expect((await db.query('select status,billing_state from aigc.image_jobs where id=$1', [bundle.job.id])).rows)
      .toEqual([{ status: 'expired', billing_state: 'released' }])
    await callback(bundle.job.id)
    await maintainVideoJobs(bundle.job.id, rt)
    expect((await db.query('select status,billing_state,credits_charged from aigc.image_jobs where id=$1', [bundle.job.id])).rows)
      .toEqual([{ status: 'succeeded', billing_state: 'released', credits_charged: 0 }])
    expect((await db.query('select kind,delta from aigc.credit_ledger where job_id=$1 order by created_at', [bundle.job.id])).rows)
      .toEqual([{ kind: 'reserve', delta: -50 }, { kind: 'refund', delta: 50 }])
  })
  it('租约全环境同时最多两份，抢占后不能重复领取，过期租约可以恢复', async () => {
    const a = await create(users[0]), b = await create(users[1])
    await callback(a.bundle.job.id); await callback(b.bundle.job.id)
    const first = await identity('', 'production', sql => sql`select * from aigc.claim_due_video_jobs('production')`)
    expect(first).toHaveLength(2)
    const second = await identity('', 'production', sql => sql`select * from aigc.claim_due_video_jobs('production')`)
    expect(second).toHaveLength(0)
    await db.exec("update aigc.image_jobs set lease_until=now()-interval '1 second'")
    expect(await identity('', 'production', sql => sql`select * from aigc.claim_due_video_jobs('production')`)).toHaveLength(2)
    await expect(identity(users[0], 'production', sql => sql`select * from aigc.claim_due_video_jobs('production')`)).rejects.toThrow('视频后台环境无效')
    await expect(identity('', 'preview', sql => sql`select * from aigc.claim_due_video_jobs('production')`)).rejects.toThrow('视频后台环境无效')
  })
  it('错误签名、错误环境和不匹配的上游任务标识均被拒绝', async () => {
    const { bundle } = await create()
    await expect(recordVideoCallback(new URLSearchParams({ jobId: bundle.job.id, scope: 'production', token: 'bad' }), { id: 'cgt-test' }))
      .rejects.toMatchObject({ status: 401 })
    await identity(users[0], 'production', sql => applyVideoSubmission(createSqlStore(sql, users[0], 'video'), bundle.job.id, runtime(), 'cgt-test'))
    await expect(callback(bundle.job.id, 'cgt-other')).rejects.toMatchObject({ status: 409 })
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview')
    await expect(callback(bundle.job.id)).rejects.toMatchObject({ status: 401 })
  })
  it('过期视频先删除 R2，再删除任务；存储删除失败时保留可重试记录', async () => {
    const { bundle } = await create(), rt = runtime()
    await callback(bundle.job.id); await maintainVideoJobs(bundle.job.id, rt)
    await db.query("update aigc.image_jobs set expires_at=now()-interval '1 second' where id=$1", [bundle.job.id])
    mocks.remove.mockRejectedValueOnce(new Error('模拟存储不可用'))
    await maintainVideoJobs(bundle.job.id, rt)
    expect((await db.query('select id from aigc.image_jobs where id=$1', [bundle.job.id])).rows).toHaveLength(1)
    await db.exec("update aigc.image_jobs set lease_until=now()-interval '1 second'")
    await maintainVideoJobs(bundle.job.id, rt)
    expect((await db.query('select id from aigc.image_jobs where id=$1', [bundle.job.id])).rows).toHaveLength(0)
    expect(mocks.remove).toHaveBeenCalledWith(`generated/${users[0]}/video/${bundle.job.id}/0.mp4`, expect.any(AbortSignal))
  })
  it('视频和封面不走字节代理，到期、跨账号或跨环境均无法签名', async () => {
    const { bundle } = await create(), rt = runtime()
    await callback(bundle.job.id); await maintainVideoJobs(bundle.job.id, rt)
    const key = `generated/${users[0]}/video/${bundle.job.id}/0.mp4`
    const owner = { id: users[0], email: '', suggestedName: '', avatarUrl: null, providers: [] }
    await expect(loadOwnedObject(owner, key)).rejects.toMatchObject({ code: 'VIDEO_DIRECT_READ_REQUIRED' })
    await expect(loadOwnedObject(owner, key.replace('0.mp4', 'poster.jpg'))).rejects.toMatchObject({ code: 'VIDEO_DIRECT_READ_REQUIRED' })
    await expect(signOwnedObjectRead({ ...owner, id: users[1] }, key)).rejects.toMatchObject({ code: 'INVALID_SOURCE' })
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'preview')
    await expect(signOwnedObjectRead(owner, key)).rejects.toMatchObject({ code: 'VIDEO_EXPIRED' })
    vi.stubEnv('AIGC_RUNTIME_SCOPE', 'production')
    await db.query("update aigc.image_jobs set expires_at=now()-interval '1 second' where id=$1", [bundle.job.id])
    await expect(signOwnedObjectRead(owner, key)).rejects.toMatchObject({ code: 'VIDEO_EXPIRED' })
    await identity('', 'production', sql => sql`select aigc.purge_expired_image_jobs()`)
    expect((await db.query('select id from aigc.image_jobs where id=$1', [bundle.job.id])).rows).toHaveLength(1)
  })
})
