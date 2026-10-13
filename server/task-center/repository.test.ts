import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { beforeAll, afterAll, describe, it, expect } from 'vitest'
import { bootstrapImageTestDatabase } from '../image-jobs/database-fixture.js'
import { taskRepository, taskSummary, type TaskQuery } from './repository.js'
import { detailSnapshot, presentTaskDetail } from './service.js'
import type { TaskScope } from '../../shared/task-center.js'

const users = [
  '00000000-0000-4000-8000-000000000071',
  '00000000-0000-4000-8000-000000000072',
]
const recentSecond = new Date(Date.now() - 3600000).toISOString().slice(0, 20)
let fixtureCounter = 100000
const recentInstant = (micros: string) => `${recentSecond}${micros.padStart(6, '0')}Z`
let db: PGlite
const port: TaskQuery = {
  query: async (text, values = []) =>
    (await db.query<Record<string, unknown>>(text, values)).rows,
}
beforeAll(async () => {
  db = new PGlite()
  await bootstrapImageTestDatabase((s) => db.exec(s), users)
}, 30000)
afterAll(async () => {
  await db.close()
})
async function actor<T>(
  owner: string,
  scope: TaskScope,
  action: (repo: ReturnType<typeof taskRepository>) => Promise<T>,
  readOnly = false,
) {
  await db.exec(`begin${readOnly ? ' read only' : ''}; set local role aigc_api`)
  try {
    await db.query(
      "select set_config('aigc.user_id',$1,true),set_config('aigc.scope',$2,true)",
      [owner, scope],
    )
    const result = await action(taskRepository(port, owner, scope))
    await db.exec('commit')
    return result
  } catch (error) {
    await db.exec('rollback')
    throw error
  }
}
async function fixture(
  owner = users[0],
  scope: TaskScope = 'local',
  created = recentInstant(String(++fixtureCounter)),
) {
  const image = randomUUID(),
    sync = randomUUID(),
    email = randomUUID()
  await actor(owner, scope, async () => {
    await db.query('select aigc.ensure_credit_account($1)', [owner])
  })
  await db.query(
    `insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,params,provider_params,requested_count,status,credits_reserved,billing_state,credits_charged,created_at,deadline_at,next_poll_at)
    values($1,$2,$3,$4,'hash','variation','fixture','mock','{}','{}',2,'succeeded',4,'settled',2,$5::timestamptz,now()+interval '5 minutes',now())`,
    [image, owner, scope, randomUUID(), created],
  )
  for (let i = 0; i < 2; i++)
    await db.query(
      `insert into aigc.image_job_items(job_id,user_id,scope,ordinal,status,result_object_key,result_mime_type,result_width,result_height)
    values($1,$2,$3,$4,$5,$6,'image/png',1,1)`,
      [
        image,
        owner,
        scope,
        i,
        i === 0 ? 'succeeded' : 'expired',
        i === 0
          ? `generated/${owner}/${scope}/${image}/0/${randomUUID()}.png`
          : null,
      ],
    )
  await db.query(
    `insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged) values($1,$2,'settle',2,30,$3,$4,2)`,
    [owner, scope, image, `fixture:${image}`],
  )
  await db.query(
    `insert into aigc.sync_credit_jobs(id,user_id,scope,operation,fingerprint,price_version,credits_reserved,state,result,created_at)
    values($1,$2,$3,'bg-remove','hash','v',0,'settled',$4,$5::timestamptz)`,
    [
      sync,
      owner,
      scope,
      {
        objectKey: `temporary/bg-remove-results/${owner}/${sync}.png`,
        mimeType: 'image/png',
        bytes: 1,
        chargedCredits: 0,
      },
      created,
    ],
  )
  await db.query(
    `insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged) values($1,$2,'settle',0,30,$3,$4,0)`,
    [owner, scope, sync, `fixture:${sync}`],
  )
  await db.query(
    `insert into aigc.email_tasks(id,user_id,scope,request_id,request_fingerprint,params,status,result_text,billing_state,created_at,model_profile_id)
    values($1,$2,$3,$4,'hash',$5,'succeeded','原结果','legacy_free',$6::timestamptz,'fixture')`,
    [
      email,
      owner,
      scope,
      randomUUID(),
      { sourceText: '私有正文', operation: 'reply' },
      created,
    ],
  )
  return { image, sync, email }
}

describe('统一任务只读查询、展示权限和分页', () => {
  it('三源已查看与移除均成功，同步原表和账本不被修改', async () => {
    const f = await fixture()
    const before = (await db.query('select to_jsonb(j) as data from aigc.sync_credit_jobs j where id=$1',[f.sync])).rows
    const ledger = (await db.query('select count(*)::int as n from aigc.credit_ledger')).rows
    for (const [kind,id] of [['image_job',f.image],['sync_credit',f.sync],['email_task',f.email]] as const) {
      await actor(users[0],'local',async r=>{
        const task = taskSummary(await r.get(kind,id))
        expect((await r.presentation(kind,id,'seen',task.outcomeVersion!)).seen).toBe(true)
        expect((await r.presentation(kind,id,'dismiss',task.outcomeVersion!)).dismissed).toBe(true)
      })
    }
    expect((await db.query('select to_jsonb(j) as data from aigc.sync_credit_jobs j where id=$1',[f.sync])).rows).toEqual(before)
    expect((await db.query('select count(*)::int as n from aigc.credit_ledger')).rows).toEqual(ledger)
    expect((await db.query<{permitted:boolean}>("select has_any_column_privilege('aigc_api','aigc.sync_credit_jobs','UPDATE') as permitted")).rows[0].permitted).toBe(false)
  })
  it('同步锁函数拒绝跨账号、跨环境及直接客户端调用，旧版本返回409', async () => {
    const f = await fixture()
    const original = await actor(users[0],'local',async r=>taskSummary(await r.get('sync_credit',f.sync)))
    for(const [owner,scope] of [[users[1],'local'],[users[0],'preview'],[users[0],'production']] as const) {
      await expect(actor(owner,scope,r=>r.presentation('sync_credit',f.sync,'seen',original.outcomeVersion!))).rejects.toMatchObject({status:404})
    }
    await db.query("update aigc.sync_credit_jobs set result=jsonb_set(result,'{objectKey}','\"temporary/new.png\"') where id=$1",[f.sync])
    await expect(actor(users[0],'local',r=>r.presentation('sync_credit',f.sync,'seen',original.outcomeVersion!))).rejects.toMatchObject({status:409})
    for(const role of ['anon','authenticated']) {
      expect((await db.query<{permitted:boolean}>('select has_function_privilege($1,\'aigc.lock_task_center_sync(uuid)\',\'EXECUTE\') as permitted',[role])).rows[0].permitted).toBe(false)
    }
  })
  it('三源状态与费用分开投影，免费记录可发现，摘要不带正文或对象键', async () => {
    const f = await fixture()
    const data = await actor(
      users[0],
      'local',
      (r) => r.history({ limit: 50 }),
      true,
    )
    const image = data.items.find((x) => x.sourceId === f.image)!,
      sync = data.items.find((x) => x.sourceId === f.sync)!
    expect(image).toMatchObject({
      state: 'succeeded',
      partial: true,
      requestedCount: 2,
      completedCount: 1,
      billingState: 'settled',
      creditsCharged: 2,
      creditsReturned: 2,
      origin: null,
      tool: 'variation',
    })
    expect(sync).toMatchObject({
      state: 'succeeded',
      billingState: 'settled',
      creditsReserved: 0,
      creditsCharged: 0,
      creditsReturned: 0,
    })
    expect(JSON.stringify(data)).not.toContain('私有正文')
    expect(JSON.stringify(data)).not.toContain('generated/')
    expect(JSON.stringify(data)).not.toContain('原结果')
  })
  it('已查看与移除绑定版本，迟到补图重新进入近期列表', async () => {
    const f = await fixture(),
      before = await actor(users[0], 'local', async (r) => {
        const summary = taskSummary(await r.get('image_job', f.image))
        await r.presentation('image_job', f.image, 'seen', summary.outcomeVersion!)
        const sidebarAfterSeen = await r.sidebar()
        expect(sidebarAfterSeen.items.map((i) => i.sourceId)).toContain(f.image)
        return summary
      })
    await actor(users[0], 'local', async (r) => {
      await r.presentation('image_job', f.image, 'dismiss', before.outcomeVersion!)
      const sidebarAfterDismiss = await r.sidebar()
      expect(sidebarAfterDismiss.items.map((i) => i.sourceId)).not.toContain(f.image)
    })
    expect(
      (await actor(users[0], 'local', (r) => r.get('image_job', f.image)))
        .dismissed,
    ).toBe(true)
    await db.query(
      "update aigc.image_job_items set status='succeeded',result_object_key=$2 where job_id=$1 and ordinal=1",
      [f.image, `generated/${users[0]}/local/${f.image}/1/new.png`],
    )
    const next = await actor(users[0], 'local', async (r) =>
      taskSummary(await r.get('image_job', f.image)),
    )
    expect(next.outcomeVersion).not.toBe(before.outcomeVersion)
    expect(next.dismissed).toBe(false)
    await expect(
      actor(users[0], 'local', (r) =>
        r.presentation('image_job', f.image, 'dismiss', before.outcomeVersion!),
      ),
    ).rejects.toMatchObject({ status: 409 })
    const email = await actor(users[0], 'local', async (r) =>
      taskSummary(await r.get('email_task', f.email)),
    )
    await db.query(
      "update aigc.email_tasks set edited_text='编辑后的正文',updated_at=now() where id=$1",
      [f.email],
    )
    expect(
      (await actor(users[0], 'local', (r) => r.get('email_task', f.email)))
        .outcome_version,
    ).toBe(email.outcomeVersion)
  })
  it('两账号三环境的读取和展示写入隔离，不开放同步表写权限', async () => {
    const f = await fixture(users[0], 'preview')
    for (const owner of users)
      for (const scope of ['local', 'preview', 'production'] as const) {
        if (owner === users[0] && scope === 'preview') continue
        await expect(
          actor(owner, scope, (r) => r.get('image_job', f.image)),
        ).rejects.toMatchObject({ status: 404 })
        await expect(
          actor(owner, scope, async () => {
            await db.query(
              `insert into aigc.task_ui_state(user_id,scope,source_kind,source_id) values($1,$2,'image_job',$3)`,
              [owner, scope, f.image],
            )
          }),
        ).rejects.toThrow()
      }
    const [priv] = await port.query(
      "select has_table_privilege('aigc_api','aigc.sync_credit_jobs','UPDATE') as write,has_table_privilege('anon','aigc.task_ui_state','SELECT') as public",
    )
    expect(priv).toEqual({ write: false, public: false })
  })
  it('同毫秒不同微秒、同时间的三源分页稳定；游标绑定筛选和账号', async () => {
    await fixture(users[1], 'production', recentInstant('123111'))
    await fixture(users[1], 'production', recentInstant('123222'))
    await fixture(users[1], 'production', recentInstant('123333'))
    const ids: string[] = []
    let cursor: string | undefined
    do {
      const page = await actor(
        users[1],
        'production',
        (r) => r.history({ limit: 2, cursor }),
        true,
      )
      ids.push(...page.items.map((x) => x.taskKey))
      cursor = page.nextCursor ?? undefined
    } while (cursor)
    expect(ids).toHaveLength(9)
    expect(new Set(ids).size).toBe(9)
    const first = await actor(
      users[1],
      'production',
      (r) => r.history({ limit: 2 }),
      true,
    )
    await expect(
      actor(users[1], 'production', (r) =>
        r.history({ limit: 2, cursor: first.nextCursor, tool: 'variation' }),
      ),
    ).rejects.toMatchObject({ status: 400 })
    await expect(
      actor(users[0], 'production', (r) =>
        r.history({ limit: 2, cursor: first.nextCursor }),
      ),
    ).rejects.toMatchObject({ status: 400 })
  })
  it('伪造无效日期或时间上界的游标返回400', async () => {
    await fixture()
    const page = await actor(users[0], 'local', (r) => r.history({ limit: 1 }))
    const decoded = JSON.parse(
      Buffer.from(page.nextCursor!, 'base64url').toString(),
    )
    for (const patch of [
      { time: '2026-02-30T04:00:00.123456Z' },
      { time: '0000-01-01T04:00:00.123456Z' },
      { time: '9999-01-01T04:00:00.123456Z' },
    ]) {
      const cursor = Buffer.from(
        JSON.stringify({ ...decoded, ...patch }),
      ).toString('base64url')
      await expect(
        actor(users[0], 'local', (r) => r.history({ limit: 1, cursor })),
      ).rejects.toMatchObject({ status: 400 })
    }
  })

  it('到期预留查询不退款、不推进；未知账本金额不被补猜', async () => {
    const f = await fixture()
    await db.query(
      "update aigc.image_jobs set status='processing',billing_state='reserved',deadline_at=now()-interval '1 day' where id=$1",
      [f.image],
    )
    const before = await port.query(
      'select * from aigc.credit_ledger where job_id=$1',
      [f.image],
    )
    await actor(
      users[0],
      'local',
      async (r) => {
        await r.sidebar()
        await r.history({ state: 'active' })
        const row = taskSummary(await r.get('image_job', f.image))
        expect(row.creditsCharged).toBeNull()
        expect(row.creditsReturned).toBeNull()
      },
      true,
    )
    expect(
      await port.query('select * from aigc.credit_ledger where job_id=$1', [
        f.image,
      ]),
    ).toEqual(before)
    expect(
      (
        await port.query(
          'select status,billing_state from aigc.image_jobs where id=$1',
          [f.image],
        )
      )[0],
    ).toEqual({ status: 'processing', billing_state: 'reserved' })
    await expect(
      actor(users[0], 'local', (r) =>
        r.presentation(
          'image_job',
          f.image,
          'dismiss',
          'v1:00000000000000000000000000000000',
        ),
      ),
    ).rejects.toMatchObject({ status: 409 })
  })
  it('同步新旧 RPC 兼容，重入保留首次来源，原哈希与免费账本不变', async () => {
    const id = randomUUID()
    const first = await actor(
      users[0],
      'local',
      async () =>
        (
          await db.query<Record<string, unknown>>(
            'select aigc.reserve_sync_credits($1,$2,$3,$4,$5,$6) as j',
            [
              id,
              'bg-remove',
              'a'.repeat(64),
              'aigc-sync-v1',
              0,
              { entry: 'toolbox', tool: 'bg-remove' },
            ],
          )
        ).rows[0].j,
    )
    expect(first).toMatchObject({
      origin: { entry: 'toolbox', tool: 'bg-remove' },
      reused: false,
      credits_reserved: 0,
    })
    const second = await actor(
      users[0],
      'local',
      async () =>
        (
          await db.query<Record<string, unknown>>(
            'select aigc.reserve_sync_credits($1,$2,$3,$4,$5) as j',
            [id, 'bg-remove', 'a'.repeat(64), 'aigc-sync-v1', 0],
          )
        ).rows[0].j,
    )
    expect(second).toMatchObject({
      origin: { entry: 'toolbox', tool: 'bg-remove' },
      reused: true,
    })
  })
  it('终态等待结算显示待核对，超时退款金额来自账本，过期详情返回410', async () => {
    const f = await fixture()
    await db.query('delete from aigc.credit_ledger where job_id=$1', [f.image])
    const unknown = await actor(users[0], 'local', async (r) =>
      taskSummary(await r.get('image_job', f.image)),
    )
    expect(unknown).toMatchObject({
      state: 'succeeded',
      billingState: 'unknown',
      creditsCharged: null,
      creditsReturned: null,
    })
    await db.query(
      "update aigc.image_jobs set status='expired',billing_state='released',credits_charged=0,error_code='TASK_TIMEOUT' where id=$1",
      [f.image],
    )
    await db.query(
      "insert into aigc.credit_ledger(user_id,scope,kind,delta,balance_after,job_id,idempotency_key,charged) values($1,'local','refund',4,30,$2,$3,0)",
      [users[0], f.image, `refund:${f.image}`],
    )
    expect(
      await actor(users[0], 'local', async (r) =>
        taskSummary(await r.get('image_job', f.image)),
      ),
    ).toMatchObject({
      state: 'expired',
      billingState: 'refunded',
      creditsCharged: 0,
      creditsReturned: 4,
    })
    await db.query(
      "update aigc.email_tasks set expires_at=now()-interval '1 second' where id=$1",
      [f.email],
    )
    await expect(
      actor(users[0], 'local', (r) => r.get('email_task', f.email)),
    ).rejects.toMatchObject({ status: 410 })
    await db.query(
      "update aigc.sync_credit_jobs set created_at=now()-interval '8 days' where id=$1",
      [f.sync],
    )
    expect(
      await actor(users[0], 'local', async (r) =>
        taskSummary(await r.get('sync_credit', f.sync)),
      ),
    ).toMatchObject({
      state: 'succeeded',
      resultAvailability: 'available',
      resultExpiresAt: null,
      creditsCharged: 0,
    })
  })

  it.each([
    ['S01 排队', 'queued', 'reserved', 0, null, 'pending'],
    ['S02 处理中已有结果', 'processing', 'reserved', 1, null, 'available'],
    ['S03 全部成功', 'succeeded', 'settled', 2, 4, 'available'],
    ['S05 普通失败', 'failed', 'released', 0, 0, 'unavailable'],
    ['S06 已超时', 'expired', 'released', 0, 0, 'unavailable'],
    ['S12 终态等待结算', 'failed', 'reserved', 0, null, 'unavailable'],
  ] as const)(
    '%s 保持执行、账本和结果的独立事实',
    async (_name, state, billing, count, charged, availability) => {
      const f = await fixture()
      await db.query(
        'update aigc.image_jobs set status=$2,billing_state=$3,credits_charged=$4,error_code=$5 where id=$1',
        [
          f.image,
          state,
          billing,
          charged ?? 0,
          state === 'expired' ? 'TASK_TIMEOUT' : null,
        ],
      )
      await db.query(
        "update aigc.image_job_items set status=case when ordinal<$2 then 'succeeded' else 'failed' end,result_object_key=case when ordinal<$2 then 'generated/'||user_id||'/'||scope||'/'||job_id||'/'||ordinal||'/fixture.png' else null end where job_id=$1",
        [f.image, count],
      )
      if (charged !== null)
        await db.query(
          'update aigc.credit_ledger set kind=$2,charged=$3,delta=4-$3 where job_id=$1',
          [f.image, billing === 'released' ? 'refund' : 'settle', charged],
        )
      const result = await actor(
        users[0],
        'local',
        async (r) => taskSummary(await r.get('image_job', f.image)),
        true,
      )
      expect(result).toMatchObject({
        state,
        billingState: billing === 'released' ? 'refunded' : billing,
        completedCount: count,
        partial: false,
        creditsCharged: charged,
        resultAvailability: availability,
      })
      if (billing === 'reserved') expect(result.creditsReturned).toBeNull()
    },
  )
  it('S11 免费失败不显示虚假退款，S08 明确过期结果不再签名', async () => {
    const f = await fixture()
    await db.query(
      "update aigc.sync_credit_jobs set state='refunded',result=null,error_code='TEST_FAILURE' where id=$1",
      [f.sync],
    )
    await db.query(
      "update aigc.credit_ledger set kind='refund' where job_id=$1",
      [f.sync],
    )
    expect(
      await actor(users[0], 'local', async (r) =>
        taskSummary(await r.get('sync_credit', f.sync)),
      ),
    ).toMatchObject({
      state: 'failed',
      billingState: 'refunded',
      creditsCharged: 0,
      creditsReturned: 0,
      resultAvailability: 'unavailable',
    })
    const snapshot = await actor(
      users[0],
      'local',
      () => detailSnapshot(port, users[0], 'local', 'image_job', f.image),
      true,
    )
    snapshot.task = {
      ...snapshot.task,
      resultAvailability: 'expired',
      resultExpiresAt: new Date(Date.now() - 1000).toISOString(),
    }
    const head = async () => {
        throw new Error('过期结果不应读取对象')
      },
      sign = async () => {
        throw new Error('过期结果不应重签')
      }
    const detail = await presentTaskDetail(snapshot, users[0], {
      safe: () => true,
      head,
      sign,
    })
    expect(detail.task).toMatchObject({
      state: 'succeeded',
      creditsCharged: 2,
      resultAvailability: 'expired',
    })
  })

  it('对象读取失败只改变详情可用性，原成功和积分不变；文本仅详情返回', async () => {
    const f = await fixture()
    const snapshot = await actor(
      users[0],
      'local',
      () => detailSnapshot(port, users[0], 'local', 'image_job', f.image),
      true,
    )
    const detail = await presentTaskDetail(snapshot, users[0], {
      safe: () => true,
      head: async () => {
        throw new Error('对象缺失')
      },
      sign: async () => ({
        url: 'https://test',
        expiresAt: Date.now() + 900000,
      }),
    })
    expect(detail.task).toMatchObject({
      state: 'succeeded',
      creditsCharged: 2,
      resultAvailability: 'unavailable',
    })
    const mail = await actor(
      users[0],
      'local',
      () => detailSnapshot(port, users[0], 'local', 'email_task', f.email),
      true,
    )
    expect((await presentTaskDetail(mail, users[0])).results).toEqual([
      { kind: 'text', text: '原结果', editedText: null },
    ])
  })
})
