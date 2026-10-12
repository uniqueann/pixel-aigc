import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { afterAll,beforeAll,describe,expect,it } from 'vitest'
import { bootstrapImageTestDatabase } from './database-fixture.js'

const users = ['00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000032']
let db: PGlite
beforeAll(async () => {
  db = new PGlite()
  await bootstrapImageTestDatabase(sql => db.exec(sql),users)
},30_000)
afterAll(async () => { await db.close() })

async function identity<T>(user: string,scope: string,action: () => Promise<T>) {
  await db.exec('begin; set local role aigc_api')
  try {
    await db.query<Record<string,unknown>>("select set_config('aigc.user_id',$1,true),set_config('aigc.scope',$2,true)",[user,scope])
    const result = await action(); await db.exec('commit'); return result
  } catch (error) { await db.exec('rollback'); throw error }
}

async function job(user = users[0],scope = 'local',model = 'mock:image-stage2',count = 1) {
  const id = randomUUID(); const token = randomUUID()
  await identity(user,scope,async () => {
    await db.query<Record<string,unknown>>('select aigc.ensure_credit_account($1)',[user])
    await db.query<Record<string,unknown>>("select aigc.reserve_image_credits($1,$2,$3,'{}')",[user,id,count * 2])
    await db.query<Record<string,unknown>>(`insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,
      params,provider_params,requested_count,status,credits_reserved,billing_state,deadline_at,lease_token,lease_owner,lease_until)
      values($1,$2,$3,$4,'hash','text_to_image',$5,'mock','{}','{}',$6,'queued',$7,'reserved',now()+interval '5 minutes',$8,'submit',now()+interval '120 seconds')`,
    [id,user,scope,randomUUID(),model,count,count * 2,token])
    for (let ordinal = 0; ordinal < count; ordinal += 1) await db.query<Record<string,unknown>>(`insert into aigc.image_job_items(job_id,ordinal,user_id,scope,status,submission_state)
      values($1,$2,$3,$4,'pending','not_sent')`,[id,ordinal,user,scope])
  })
  return { id,token,user,scope }
}

describe('图片执行迁移、权限与账本',() => {
  it('发送意图只申请一次；同一百炼批次所有序号共享尝试',async () => {
    const j = await job(users[0],'local','bailian:qwen-image-3.0',3)
    const attempt = randomUUID()
    await identity(j.user,j.scope,async () => {
      const first = await db.query<Record<string,unknown>>('select * from aigc.start_image_submission($1,$2,$3,$4)',[j.id,j.token,[0,1,2],attempt])
      expect(first.rows).toHaveLength(1)
      const duplicate = await db.query<Record<string,unknown>>('select * from aigc.start_image_submission($1,$2,$3,$4)',[j.id,j.token,[0,1,2],randomUUID()])
      expect(duplicate.rows).toHaveLength(0)
      const items = await db.query<Record<string,unknown>>('select submission_attempt_id,submission_state,attempts from aigc.image_job_items where job_id=$1',[j.id])
      expect(items.rows).toHaveLength(3)
      expect(items.rows.every(row => row.submission_attempt_id === attempt && row.submission_state === 'sending' && row.attempts === 1)).toBe(true)
    })
  })

  it('应用角色直接写旧令牌会失败；新令牌写进度后只结算一次',async () => {
    const j = await job()
    const newToken = randomUUID()
    await db.query<Record<string,unknown>>("update aigc.image_jobs set lease_token=$2,lease_until=now()+interval '120 seconds' where id=$1",[j.id,newToken])
    await expect(identity(j.user,j.scope,async () => {
      await db.query<Record<string,unknown>>("select set_config('aigc.image_lease_token',$1,true)",[j.token])
      await db.query<Record<string,unknown>>('update aigc.image_job_items set progress=10 where job_id=$1',[j.id])
    })).rejects.toThrow('租约已失效')
    await expect(identity(j.user,j.scope,async () => {
      await db.query<Record<string,unknown>>("select set_config('aigc.image_lease_token',$1,true)",[j.token])
      await db.query<Record<string,unknown>>("select aigc.finish_image_credits($1,0,'refund')",[j.id])
    })).rejects.toThrow('租约已失效')
    await identity(j.user,j.scope,async () => {
      await db.query<Record<string,unknown>>("select set_config('aigc.image_lease_token',$1,true)",[newToken])
      await db.query<Record<string,unknown>>('update aigc.image_job_items set progress=80 where job_id=$1',[j.id])
      await db.query<Record<string,unknown>>("select aigc.finish_image_credits($1,2,'settle')",[j.id])
      await db.query<Record<string,unknown>>("select aigc.finish_image_credits($1,2,'settle')",[j.id])
    })
    expect((await db.query<Record<string,unknown>>('select progress from aigc.image_job_items where job_id=$1',[j.id])).rows[0].progress).toBe(80)
    expect((await db.query<Record<string,unknown>>("select count(*)::integer as n from aigc.credit_ledger where job_id=$1 and kind='settle'",[j.id])).rows[0].n).toBe(1)
    for (const until of [new Date(Date.now()-60_000),null]) {
      await db.query('update aigc.image_jobs set lease_until=$2 where id=$1',[j.id,until])
      await expect(identity(j.user,j.scope,async () => {
        await db.query("select set_config('aigc.image_lease_token',$1,true)",[newToken])
        await db.query('update aigc.image_job_items set progress=10 where job_id=$1',[j.id])
      })).rejects.toThrow('租约已失效')
    }
  })

  it('到期清理跳过有效租约；部分成功按已入库数量结算，后续写回不重复收费',async () => {
    const j = await job(users[0],'preview','mock:image-stage2',2)
    await db.query<Record<string,unknown>>("update aigc.image_jobs set deadline_at=now()-interval '1 minute' where id=$1",[j.id])
    await identity('',j.scope,async () => {
      expect((await db.query<Record<string,unknown>>('select aigc.expire_overdue_image_jobs() as n')).rows[0].n).toBe(0)
    })
    await db.query<Record<string,unknown>>("update aigc.image_jobs set lease_until=now()-interval '1 second' where id=$1",[j.id])
    await db.query<Record<string,unknown>>("update aigc.image_job_items set status='succeeded',result_object_key='generated/test' where job_id=$1 and ordinal=0",[j.id])
    await identity('',j.scope,async () => {
      expect((await db.query<Record<string,unknown>>('select aigc.expire_overdue_image_jobs() as n')).rows[0].n).toBe(1)
      expect((await db.query<Record<string,unknown>>('select aigc.expire_overdue_image_jobs() as n')).rows[0].n).toBe(0)
    })
    const row = (await db.query<Record<string,unknown>>('select status,billing_state,credits_charged,lease_token from aigc.image_jobs where id=$1',[j.id])).rows[0]
    expect(row).toMatchObject({ status: 'succeeded',billing_state: 'settled',credits_charged: 2,lease_token: null })
  })

  it('两个账号、三环境不能交叉读取凭据；清理只作用于当前环境和指定用户',async () => {
    const jobs: Array<Awaited<ReturnType<typeof job>>> = []
    for (const scope of ['local','preview','production']) {
      const j = await job(users[1],scope); jobs.push(j)
      await db.query<Record<string,unknown>>("update aigc.image_jobs set deadline_at=now()-interval '1 minute',lease_until=null where id=$1",[j.id])
    }
    await identity(users[0],'local',async () => {
      expect((await db.query<Record<string,unknown>>('select * from aigc.image_jobs where id=any($1::uuid[])',[jobs.map(j => j.id)])).rows).toHaveLength(0)
      await expect(db.query<Record<string,unknown>>('select aigc.expire_overdue_image_jobs($1)',[users[1]])).rejects.toThrow('其他用户')
    }).catch(error => { if (!String(error).includes('aborted')) throw error })
    await identity('', 'production',async () => { await db.query<Record<string,unknown>>('select aigc.expire_overdue_image_jobs()') })
    const rows = (await db.query<Record<string,unknown>>('select scope,status from aigc.image_jobs where id=any($1::uuid[]) order by scope',[jobs.map(j => j.id)])).rows
    expect(rows).toEqual([{ scope: 'local',status: 'queued' },{ scope: 'preview',status: 'queued' },{ scope: 'production',status: 'expired' }])
  })

  it('提交凭据按账号和环境隔离，匿名与登录客户端角色不能读表或调用领取函数',async () => {
    const j = await job(users[0],'preview')
    const attempt = randomUUID()
    await identity(j.user,j.scope,async () => {
      await db.query('select * from aigc.start_image_submission($1,$2,array[0],$3)',[j.id,j.token,attempt])
    })
    for (const [user,scope] of [[users[1],'preview'],[users[0],'production']]) {
      await identity(user,scope,async () => {
        expect((await db.query('select * from aigc.image_job_attempts where id=$1',[attempt])).rows).toHaveLength(0)
        expect((await db.query("update aigc.image_job_attempts set outcome='accepted',provider_task_id='伪回执' where id=$1 returning id",[attempt])).rows).toHaveLength(0)
      })
    }
    for (const role of ['anon','authenticated']) {
      for (const query of ['select * from aigc.image_job_attempts',"select * from aigc.claim_due_image_job('preview')"]) {
        await db.exec(`begin; set local role ${role}`)
        try { await expect(db.query(query)).rejects.toThrow(/permission denied/) }
        finally { await db.exec('rollback') }
      }
    }
    expect((await db.query<{ outcome: string | null }>('select outcome from aigc.image_job_attempts where id=$1',[attempt])).rows[0].outcome).toBeNull()
  })

  it('平台 Pro 每分钟最多四次提交尝试，跨账号共享，拒绝也计数',async () => {
    // 先创建四个原任务，再按受理明确拒绝后的新尝试消耗剩余预算。
    const j = await job(users[1],'preview','bailian:qwen-image-3.0-pro')
    await identity(j.user,j.scope,async () => {
      for (let n = 0; n < 4; n += 1) {
        const first = await db.query<Record<string,unknown>>('select * from aigc.start_image_submission($1,$2,array[0],$3)',[j.id,j.token,randomUUID()])
        expect(first.rows).toHaveLength(1)
        await db.query<Record<string,unknown>>("select set_config('aigc.image_lease_token',$1,true)",[j.token])
        await db.query<Record<string,unknown>>("update aigc.image_job_items set submission_state='not_sent' where job_id=$1",[j.id])
      }
    })
    const other = await job(users[0],'preview','bailian:qwen-image-3.0-pro')
    await identity(other.user,other.scope,async () => {
      expect((await db.query<Record<string,unknown>>('select * from aigc.start_image_submission($1,$2,array[0],$3)',[other.id,other.token,randomUUID()])).rows).toHaveLength(0)
    })
  })

  it('免费抠图超时生成 delta=0 明细，其他环境预留不受影响',async () => {
    const id = randomUUID(); const other = randomUUID()
    for (const [jobId,scope] of [[id,'preview'],[other,'production']]) {
      await identity(users[1],scope,async () => { await db.query<Record<string,unknown>>('select aigc.ensure_credit_account($1)',[users[1]]) })
      await db.query<Record<string,unknown>>(`insert into aigc.sync_credit_jobs(id,user_id,scope,fingerprint,price_version,operation,credits_reserved,state,deadline_at,free_month)
        values($1,$2,$3,'hash','test-v1','bg-remove',0,'reserved',now()-interval '1 minute','2026-10')`,[jobId,users[1],scope])
    }
    await identity('','preview',async () => {
      expect((await db.query<Record<string,unknown>>('select aigc.expire_sync_credits() as n')).rows[0].n).toBe(1)
      expect((await db.query<Record<string,unknown>>('select aigc.expire_sync_credits() as n')).rows[0].n).toBe(0)
    })
    expect((await db.query<Record<string,unknown>>('select delta,charged from aigc.credit_ledger where job_id=$1',[id])).rows).toEqual([{ delta: 0,charged: 0 }])
    expect((await db.query<Record<string,unknown>>('select state from aigc.sync_credit_jobs where id=$1',[other])).rows[0].state).toBe('reserved')
  })

  it('孤儿对象至少 24 小时后清理，已发布和仍在补收窗口内的对象不会领取',async () => {
    const old = await job(users[1],'local')
    const recoverable = await job(users[1],'preview')
    await db.query("update aigc.image_jobs set status='expired',billing_state='released',lease_until=null,lease_token=null,deadline_at=now()-interval '25 hours' where id=$1",[old.id])
    await db.query("update aigc.image_jobs set status='expired',billing_state='released',lease_until=null,lease_token=null,deadline_at=now()-interval '23 hours' where id=$1",[recoverable.id])
    await db.query("update aigc.image_job_items set status='expired',provider_task_id='accepted' where job_id=$1",[recoverable.id])
    const keys = ['generated/orphan','generated/published','generated/recoverable','generated/recent']
    for (const [index,key] of keys.entries()) {
      const owner = index === 2 ? recoverable : old
      await db.query(`insert into aigc.image_job_attempts(id,job_id,user_id,scope,kind,ordinals,object_key,mime_type,width,height,checksum,created_at)
        values($1,$2,$3,$4,'transfer',array[0],$5,'image/png',1,1,$6,now()-$7*interval '1 hour')`,
      [randomUUID(),owner.id,owner.user,owner.scope,key,'0'.repeat(64),index === 3 ? 1 : 25])
    }
    await db.query("update aigc.image_job_items set result_object_key=$2,status='succeeded' where job_id=$1",[old.id,keys[1]])
    await identity('','local',async () => {
      const claimed = await db.query<Record<string,unknown>>("select * from aigc.claim_image_orphans('local')")
      expect(claimed.rows.map(row => row.object_key)).toEqual([keys[0]])
      const row = claimed.rows[0]
      await db.query('select aigc.finish_image_orphan($1,$2)',[row.id,row.cleanup_token])
      expect((await db.query("select * from aigc.claim_image_orphans('local')")).rows).toHaveLength(0)
    })
    await identity('','preview',async () => {
      expect((await db.query("select * from aigc.claim_image_orphans('preview')")).rows).toHaveLength(0)
    })
  })

  it('图片领取跳过视频，同一环境最多四份有效后台租约',async () => {
    const ids: string[] = []
    for (let index = 0; index < 6; index += 1) {
      const j = await job(users[1],'production');ids.push(j.id)
      await db.query('update aigc.image_jobs set lease_until=null,lease_token=null where id=$1',[j.id])
    }
    const video = randomUUID()
    await db.query(`insert into aigc.image_jobs(id,user_id,scope,request_id,request_fingerprint,capability,model_profile_id,provider,
      params,provider_params,requested_count,status,billing_state,deadline_at)
      values($1,$2,'production',$3,'hash','text_to_video','video:test','seedance','{}','{}',1,'queued','none',now()+interval '5 minutes')`,[video,users[1],randomUUID()])
    await identity('','production',async () => {
      const claims = []
      for (let n = 0; n < 6; n += 1) claims.push(...(await db.query<Record<string,unknown>>("select * from aigc.claim_due_image_job('production')")).rows)
      expect(claims).toHaveLength(4)
      expect(claims.every(row => ids.includes(String(row.id)))).toBe(true)
    })
  })

  it('可空列兼容旧调用，接管后即使释放租约也拒绝旧协议写回',async () => {
    const j = await job(users[1],'preview')
    await db.query('update aigc.image_jobs set lease_token=null,lease_until=null where id=$1',[j.id])
    await db.query('update aigc.image_job_items set submission_state=null where job_id=$1',[j.id])
    await identity(j.user,j.scope,async () => {
      await db.query("update aigc.image_job_items set provider_task_id='legacy-accepted',status='submitted' where job_id=$1",[j.id])
      const token = randomUUID()
      await db.query("update aigc.image_jobs set lease_token=$2,lease_until=now()+interval '120 seconds' where id=$1",[j.id,token])
      await db.query("select set_config('aigc.image_lease_token',$1,true)",[token])
      await db.query("update aigc.image_job_items set submission_state='accepted',progress=80 where job_id=$1",[j.id])
      await db.query('update aigc.image_jobs set lease_token=null,lease_until=null where id=$1',[j.id])
    })
    await expect(identity(j.user,j.scope,async () => {
      await db.query('update aigc.image_job_items set progress=10 where job_id=$1',[j.id])
    })).rejects.toThrow('租约已失效')
  })

  it('旧无环境后台清理仅兼容 production，用户缺少环境仍拒绝',async () => {
    const preview = await job(users[1],'preview')
    const production = await job(users[1],'production')
    for (const j of [preview,production]) await db.query("update aigc.image_jobs set deadline_at=now()-interval '1 minute',lease_until=null where id=$1",[j.id])
    await identity('','',async () => {
      expect((await db.query<{ scope: string }>('select aigc.image_cleanup_scope() as scope')).rows[0].scope).toBe('production')
      await db.query('select aigc.expire_overdue_image_jobs()')
    })
    const rows = await db.query<{ id: string;status: string }>('select id,status from aigc.image_jobs where id=any($1::uuid[])',[ [preview.id,production.id] ])
    expect(rows.rows.find(row => row.id === preview.id)?.status).toBe('queued')
    expect(rows.rows.find(row => row.id === production.id)?.status).toBe('expired')
    await expect(identity(users[1],'',() => db.query('select aigc.expire_sync_credits()'))).rejects.toThrow('清理范围无效')
  })

  it('截止后缓存读取失败留下 pending 时，有原尝试凭据仍可领取补收',async () => {
    const j = await job(users[0],'local')
    await identity(j.user,j.scope,async () => {
      await db.query('select * from aigc.start_image_submission($1,$2,array[0],$3)',[j.id,j.token,randomUUID()])
    })
    await db.query("update aigc.image_jobs set status='expired',billing_state='released',deadline_at=now()-interval '1 minute',next_poll_at=now()-interval '1 day',lease_until=null,lease_token=null where id=$1",[j.id])
    await identity('','local',async () => {
      const claims = await db.query<{ id: string }>("select * from aigc.claim_due_image_job('local')")
      expect(claims.rows[0]?.id).toBe(j.id)
    })
  })
})
