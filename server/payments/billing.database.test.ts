import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const owner='00000000-0000-4000-8000-000000000081'
const other='00000000-0000-4000-8000-000000000082'
const legacy='00000000-0000-4000-8000-000000000083'
let db:PGlite
async function user<T>(action:()=>Promise<T>,id=owner,scope='production') {
  await db.exec('begin;set local role aigc_api')
  try {
    await db.query("select set_config('aigc.user_id',$1,true),set_config('aigc.scope',$2,true)",[id,scope])
    const result=await action();await db.exec('commit');return result
  } catch(error) {await db.exec('rollback');throw error}
}
async function worker<T>(action:()=>Promise<T>,scope='production') {
  await db.exec('begin;set local role aigc_billing_worker')
  try {
    await db.query("select set_config('aigc.scope',$1,true)",[scope])
    const result=await action();await db.exec('commit');return result
  } catch(error) {await db.exec('rollback');throw error}
}
const q=async(query:string,args:unknown[]=[]) => (await db.query<Record<string,unknown>>(query,args)).rows
beforeAll(async()=>{
  db=new PGlite()
  await db.exec('create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key)')
  for(const id of [owner,other,legacy]) await q('insert into auth.users values($1)',[id])
  for(const file of ['20260908094310_aigc_foundation.sql','20260923015953_aigc_accounts.sql','20260923020155_aigc_project_compat.sql',
    '20260923102829_aigc_email_byok.sql','20260928120000_aigc_image_jobs.sql','20260929100000_aigc_credits_and_sync_limits.sql',
    '20260929233436_aigc_credit_adjust.sql']) await db.exec(readFileSync(`supabase/migrations/${file}`,'utf8'))
  for(const id of [owner,other,legacy]) await q('insert into aigc.members(user_id) values($1)',[id])
  await user(()=>q('select aigc.ensure_credit_account($1)',[legacy]),legacy)
  await db.exec(readFileSync('supabase/migrations/20261004152128_aigc_credit_payments.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20261004222317_aigc_free_sync_credit_ledger.sql','utf8'))
  await db.exec(readFileSync('supabase/migrations/20261005034700_aigc_checkout_account_lock.sql','utf8'))
},30000)
afterAll(()=>db.close())

async function reserve(id:string,operation='erase',amount=5,userId=owner,scope='production') {
  return user(async()=>{
    const [row]=await q("select aigc.reserve_sync_credits($1,$2,$3,'aigc-sync-v1',$4) as job",[id,operation,'a'.repeat(64),amount])
    return row.job as Record<string,unknown>
  },userId,scope)
}
async function finish(id:string,result:unknown=null,userId=owner,scope='production') {
  return user(()=>q('select aigc.finish_sync_credits($1,$2::jsonb,$3)',[id,result ? JSON.stringify(result) : null,result ? null : 'TEST_FAILURE']),userId,scope)
}
async function makeOrder(userId=owner,scope='production') {
  const id=randomUUID()
  await user(async()=>{
    await q('select aigc.ensure_credit_account($1)',[userId])
    await q(`insert into aigc.credit_orders(id,user_id,scope,provider,provider_mode,pack_id,product_id,amount,currency,credits,checkout_id)
      values($1,$2,$3,'creem','live','starter','prod_aigc',199,'USD',100,$4)`,[id,userId,scope,`ch_${id}`])
  },userId,scope)
  return id
}
async function pay(id:string,amount=199,event:string=randomUUID(),scope='production') {
  return worker(()=>q("select aigc.complete_credit_order($1,$2,$3,'prod_aigc',$4,'USD',199,$5,'checkout.completed') as applied",[id,`ch_${id}`,`pay_${id}`,amount,event]),scope)
}
describe('充值与收费操作的数据库闭环',()=>{
  it('新钱包只赠送30分，老余额仍为100分，每个环境只初始化一次',async()=>{
    const [before]=await user(()=>q('select aigc.ensure_credit_account($1) as balance',[owner]))
    const [again]=await user(()=>q('select aigc.ensure_credit_account($1) as balance',[owner]))
    const [old]=await user(()=>q('select aigc.ensure_credit_account($1) as balance',[legacy]),legacy)
    expect(before.balance).toBe(30);expect(again.balance).toBe(30);expect(old.balance).toBe(100)
  })
  it('预扣只发生一次，成功不重复扣分，失败和超时完整退款',async()=>{
    const id=randomUUID(),start=Number((await user(()=>q('select balance from aigc.credit_accounts')))[0].balance)
    expect((await reserve(id)).reused).toBe(false);expect((await reserve(id)).reused).toBe(true)
    await finish(id);await finish(id)
    expect((await user(()=>q('select balance from aigc.credit_accounts')))[0].balance).toBe(start)
    const timeout=randomUUID();await reserve(timeout)
    await q("update aigc.sync_credit_jobs set deadline_at=now()-interval '1 second' where id=$1",[timeout])
    await user(()=>q('select aigc.expire_sync_credits()'));await user(()=>q('select aigc.expire_sync_credits()'))
    expect((await user(()=>q('select balance from aigc.credit_accounts')))[0].balance).toBe(start)
    expect((await q("select count(*)::int as count from aigc.credit_ledger where job_id=$1 and kind='refund'",[timeout]))[0].count).toBe(1)
  })
  it('扩图最多预扣10分，一轮成功只实扣5分，重放返回已有状态',async()=>{
    const id=randomUUID();await reserve(id,'outpaint',10)
    await finish(id,{objectKey:`temporary/outpaint-results/${owner}/${id}.jpg`,mimeType:'image/jpeg',bytes:123,chargedCredits:5})
    const job=await reserve(id,'outpaint',10)
    expect(job.state).toBe('settled')
    const [ledger]=await q("select delta,charged from aigc.credit_ledger where job_id=$1 and kind='settle'",[id])
    expect(ledger).toEqual({delta:5,charged:5})
  })
  it('抠图免费额度包含正在处理的占位，21次免费报价拒绝，失败释放额度',async()=>{
    const jobs:string[]=[]
    for(let index=0;index<20;index++) {const id=randomUUID();jobs.push(id);expect((await reserve(id,'bg-remove',0)).credits_reserved).toBe(0)}
    expect((await reserve(randomUUID(),'bg-remove',0)).quoteChanged).toBe(true)
    expect((await reserve(randomUUID(),'bg-remove',1)).credits_reserved).toBe(1)
    await finish(jobs[0]);expect((await reserve(randomUUID(),'bg-remove',0)).credits_reserved).toBe(0)
    expect((await reserve(randomUUID(),'bg-remove',0,other)).credits_reserved).toBe(0)
    expect((await reserve(randomUUID(),'bg-remove',0,owner,'preview')).credits_reserved).toBe(0)
  })
  it('免费抠图的结算、失败退回和超时都写入 0 分明细',async()=>{
    const month=(await q("select to_char(now() at time zone 'Asia/Shanghai','YYYY-MM') as month"))[0].month
    const settled=randomUUID()
    const before=Number((await user(()=>q('select balance from aigc.credit_accounts'),owner,'preview'))[0].balance)
    expect((await reserve(settled,'bg-remove',0,owner,'preview')).credits_reserved).toBe(0)
    await finish(settled,{objectKey:`temporary/bg-remove-results/${owner}/${settled}.png`,mimeType:'image/png',bytes:12,chargedCredits:0},owner,'preview')
    await finish(settled,{objectKey:`temporary/bg-remove-results/${owner}/${settled}.png`,mimeType:'image/png',bytes:12,chargedCredits:0},owner,'preview')
    const [settle]=await q('select kind,delta,charged,idempotency_key,meta from aigc.credit_ledger where job_id=$1',[settled])
    expect(settle).toMatchObject({kind:'settle',delta:0,charged:0,idempotency_key:`job:${settled}:settle`,meta:{tool:'bg-remove',free:true,free_month:month}})
    expect((await q('select count(*)::int as count from aigc.credit_ledger where job_id=$1',[settled]))[0].count).toBe(1)
    expect(Number((await user(()=>q('select balance from aigc.credit_accounts'),owner,'preview'))[0].balance)).toBe(before)
    const failed=randomUUID()
    await reserve(failed,'bg-remove',0,owner,'preview')
    await finish(failed,null,owner,'preview')
    const [refund]=await q('select kind,delta,charged,idempotency_key,meta from aigc.credit_ledger where job_id=$1',[failed])
    expect(refund).toMatchObject({kind:'refund',delta:0,charged:0,idempotency_key:`job:${failed}:refund`,meta:{tool:'bg-remove',free:true,free_month:month}})
    const timeout=randomUUID()
    await reserve(timeout,'bg-remove',0,owner,'preview')
    await q("update aigc.sync_credit_jobs set deadline_at=now()-interval '1 second' where id=$1",[timeout])
    await user(()=>q('select aigc.expire_sync_credits()'),owner,'preview')
    await user(()=>q('select aigc.expire_sync_credits()'),owner,'preview')
    const [expired]=await q('select kind,delta,charged,idempotency_key,meta from aigc.credit_ledger where job_id=$1',[timeout])
    expect(expired).toMatchObject({kind:'refund',delta:0,charged:0,idempotency_key:`job:${timeout}:refund`,meta:{tool:'bg-remove',free:true,free_month:month}})
    expect((await q('select count(*)::int as count from aigc.credit_ledger where job_id=$1',[timeout]))[0].count).toBe(1)
  })
  it('扣分记录和充值订单按用户及环境隔离，用户角色不能到账或审批现金退款',async()=>{
    const id=await makeOrder()
    expect(await user(()=>q('select id from aigc.credit_orders where id=$1',[id]),other)).toEqual([])
    expect(await user(()=>q('select id from aigc.credit_orders where id=$1',[id]),owner,'preview')).toEqual([])
    await expect(user(()=>q("select aigc.complete_credit_order($1,$2,$3,'prod_aigc',199,'USD',199,'fake','fake')",[id,`ch_${id}`,`pay_${id}`]))).rejects.toThrow(/permission denied/)
    await expect(user(()=>q("select aigc.prepare_cash_refund($1,'production',199,'fake','user','退款')",[id]))).rejects.toThrow(/permission denied/)
  })
  it('错误金额或环境不会发积分；重复回调和补偿查询合计到账一次',async()=>{
    const id=await makeOrder(),start=Number((await user(()=>q('select balance from aigc.credit_accounts')))[0].balance)
    await expect(pay(id,198)).rejects.toThrow('充值支付信息不一致')
    await expect(pay(id,199,randomUUID(),'preview')).rejects.toThrow('充值订单不存在')
    expect((await pay(id))[0].applied).toBe(true);expect((await pay(id))[0].applied).toBe(false)
    expect((await user(()=>q('select balance from aigc.credit_accounts')))[0].balance).toBe(start+100)
    expect((await q("select count(*)::int as count from aigc.credit_ledger where idempotency_key=$1",[`order:${id}`]))[0].count).toBe(1)
  })
  it('连续部分退款按累计金额扣回，重复与乱序事件不再扣积分',async()=>{
    const scope='preview',id=await makeOrder(owner,scope)
    const before=Number((await user(()=>q('select balance from aigc.credit_accounts'),owner,scope))[0].balance)
    await pay(id,199,'paid-partial',scope)
    const reverse=(cash:number,event:string)=>worker(()=>q("select aigc.reverse_credit_order($1,$2,'USD',$3,'refund.created')",[id,cash,event]),scope)
    await reverse(80,'partial-1');await reverse(120,'partial-2')
    await reverse(120,'partial-2');await reverse(80,'partial-old')
    const [row]=await q('select refunded_amount,revoked_credits,status from aigc.credit_orders where id=$1',[id])
    expect(row).toEqual({refunded_amount:120,revoked_credits:61,status:'paid'})
    expect((await user(()=>q('select balance from aigc.credit_accounts'),owner,scope))[0].balance).toBe(before+100-61)
    expect((await q("select count(*)::int as count from aigc.credit_ledger where meta->>'orderId'=$1 and kind='adjust'",[id]))[0].count).toBe(2)
  })
  it('先收到退款的未到账订单进入核对，后到付款回调不能再发整包积分',async()=>{
    const scope='preview',id=await makeOrder(owner,scope)
    const before=(await user(()=>q('select balance from aigc.credit_accounts'),owner,scope))[0].balance
    await worker(()=>q("select aigc.reverse_credit_order($1,199,'USD','refund-before-paid','refund.created')",[id]),scope)
    expect((await pay(id,199,'paid-after-refund',scope))[0].applied).toBe(false)
    expect((await q('select status,paid_at from aigc.credit_orders where id=$1',[id]))[0]).toEqual({status:'review',paid_at:null})
    expect((await user(()=>q('select balance from aigc.credit_accounts'),owner,scope))[0].balance).toBe(before)
    expect((await q("select count(*)::int as count from aigc.credit_ledger where idempotency_key=$1",[`order:${id}`]))[0].count).toBe(0)
  })
  it('后台角色能锁定充值订单，已有部分退款的争议保持累计金额并冻结收费',async()=>{
    const scope='preview',id=await makeOrder(legacy,scope)
    await pay(id,199,'paid-before-dispute',scope)
    await worker(()=>q("select aigc.reverse_credit_order($1,80,'USD','partial-before-dispute','refund.created')",[id]),scope)
    const before=(await user(()=>q('select balance from aigc.credit_accounts'),legacy,scope))[0].balance
    await worker(async()=>{
      const [current]=await q('select refunded_amount from aigc.credit_orders where id=$1 and scope=$2 for update',[id,scope])
      await q("select aigc.reverse_credit_order($1,$2,'USD','dispute-without-total','dispute.created')",[id,Math.max(0,Number(current.refunded_amount))])
    },scope)
    expect((await user(()=>q('select balance,payment_blocked from aigc.credit_accounts'),legacy,scope))[0]).toEqual({balance:before,payment_blocked:true})
    expect((await q('select refunded_amount,status from aigc.credit_orders where id=$1',[id]))[0]).toEqual({refunded_amount:80,status:'review'})
  })
  it('人工审核先冻结未使用积分，现金退款回调不会二次扣分',async()=>{
    const id=await makeOrder(other);await pay(id)
    await user(()=>q('update aigc.credit_orders set refund_requested=true where id=$1',[id]),other)
    const [prepared]=await q("select aigc.prepare_cash_refund($1,'production',199,$2,'审核员','未使用订单退款') as held",[id,`review:${id}`])
    expect(prepared.held).toBe(100)
    const afterHold=(await user(()=>q('select balance from aigc.credit_accounts'),other))[0].balance
    await worker(()=>q("select aigc.reverse_credit_order($1,199,'USD','refund-test','refund.created')",[id]))
    expect((await user(()=>q('select balance from aigc.credit_accounts'),other))[0].balance).toBe(afterHold)
    expect((await q('select status,refund_held_credits from aigc.credit_orders where id=$1',[id]))[0]).toEqual({status:'refunded',refund_held_credits:0})
  })
  it('外部全额退款余额不足时不产生负余额，并冻结后续收费操作',async()=>{
    const id=await makeOrder();await pay(id)
    await q('update aigc.credit_accounts set balance=3 where user_id=$1 and scope=$2',[owner,'production'])
    await worker(()=>q("select aigc.reverse_credit_order($1,199,'USD','refund-deficit','refund.created')",[id]))
    const [account]=await q("select balance,payment_blocked from aigc.credit_accounts where user_id=$1 and scope='production'",[owner])
    expect(account).toEqual({balance:0,payment_blocked:true})
    await expect(reserve(randomUUID())).rejects.toThrow('积分账户需要人工核对')
  })
  it('旧订单已消耗时，后来充值不能恢复该订单的现金退款额度',async()=>{
    const old=await makeOrder(legacy);await pay(old)
    await user(()=>q("select aigc.reserve_image_credits($1,$2,200,'{}')",[legacy,randomUUID()]),legacy)
    const later=await makeOrder(legacy);await pay(later)
    await user(()=>q('update aigc.credit_orders set refund_requested=true where id=$1',[old]),legacy)
    await expect(q("select aigc.prepare_cash_refund($1,'production',199,$2,'审核员','旧订单审核')",[old,`old-review:${old}`])).rejects.toThrow('未使用充值积分不足')
  })
  it('aigc_api 按下单语句锁定账户并写入订单，不能直接锁行或改余额',async()=>{
    await q("update aigc.credit_accounts set payment_blocked=false where user_id=$1 and scope='production'",[owner])
    const id=randomUUID()
    const created=await user(async()=>{
      await q('select aigc.ensure_credit_account($1)',[owner])
      const [locked]=await q('select aigc.lock_credit_account_for_checkout($1) as payment_blocked',[owner])
      expect(locked.payment_blocked).toBe(false)
      const locks=await q(`select c.relname from pg_locks l join pg_class c on c.oid=l.relation
        where l.pid=pg_backend_pid() and l.locktype='relation' and l.mode='RowShareLock' and c.relname='credit_accounts'`)
      expect(locks).toEqual([{relname:'credit_accounts'}])
      expect(await q('select * from aigc.credit_orders where id=$1',[id])).toEqual([])
      const [count]=await q("select count(*)::integer as count from aigc.credit_orders where created_at>now()-interval '1 hour'")
      expect(Number(count.count)).toBeLessThan(20)
      const [row]=await q(`insert into aigc.credit_orders(id,user_id,scope,provider,provider_mode,pack_id,product_id,amount,currency,credits)
        values($1,$2,'production','dodo','live','starter','prod_checkout',990,'CNY',100) returning *`,[id,owner])
      return row
    })
    expect(created).toMatchObject({id,user_id:owner,status:'pending',checkout_url:null,amount:990,credits:100})
    const [updated]=await user(()=>q(`update aigc.credit_orders set checkout_id=$2,checkout_url=$3,updated_at=now() where id=$1 returning *`,[id,`ch_${id}`,'https://checkout.example/pay']))
    expect(updated).toMatchObject({id,checkout_id:`ch_${id}`,checkout_url:'https://checkout.example/pay'})
    const again=await user(async()=>{
      const [locked]=await q('select aigc.lock_credit_account_for_checkout($1) as payment_blocked',[owner])
      const [prior]=await q('select id,checkout_url from aigc.credit_orders where id=$1',[id])
      return {locked,prior}
    })
    expect(again.locked.payment_blocked).toBe(false)
    expect(again.prior).toEqual({id,checkout_url:'https://checkout.example/pay'})
    await expect(user(()=>q('select balance,payment_blocked from aigc.credit_accounts for update'))).rejects.toThrow(/permission denied for table credit_accounts/)
    await expect(user(()=>q('update aigc.credit_accounts set balance=balance'))).rejects.toThrow(/permission denied/)
    await expect(user(()=>q('update aigc.credit_accounts set payment_blocked=false'))).rejects.toThrow(/permission denied/)
    await expect(user(()=>q('select aigc.lock_credit_account_for_checkout($1)',[owner]),other)).rejects.toThrow('积分账户不可用')
    await expect(worker(()=>q('select aigc.lock_credit_account_for_checkout($1)',[owner]))).rejects.toThrow(/permission denied/)
    const [privileges]=await q(`select
      has_table_privilege('aigc_api','aigc.credit_accounts','SELECT') as api_select,
      has_table_privilege('aigc_api','aigc.credit_accounts','UPDATE') as api_update,
      has_column_privilege('aigc_api','aigc.credit_accounts','balance','UPDATE') as balance_update,
      has_column_privilege('aigc_api','aigc.credit_accounts','payment_blocked','UPDATE') as blocked_update,
      has_function_privilege('aigc_api','aigc.lock_credit_account_for_checkout(uuid)','EXECUTE') as api_execute,
      has_function_privilege('aigc_billing_worker','aigc.lock_credit_account_for_checkout(uuid)','EXECUTE') as worker_execute`)
    expect(privileges).toEqual({api_select:true,api_update:false,balance_update:false,blocked_update:false,api_execute:true,worker_execute:false})
    const [definition]=await q("select pg_get_functiondef('aigc.lock_credit_account_for_checkout(uuid)'::regprocedure) as def")
    expect(String(definition.def).toLowerCase()).toContain('for update')
  })
  it('冻结账户的下单锁返回真，退款列更新和对账时间戳仍按原授权可用',async()=>{
    await user(()=>q('select aigc.ensure_credit_account($1)',[other]),other)
    await q("update aigc.credit_accounts set payment_blocked=true where user_id=$1 and scope='production'",[other])
    try {
      const [locked]=await user(()=>q('select aigc.lock_credit_account_for_checkout($1) as payment_blocked',[other]),other)
      expect(locked.payment_blocked).toBe(true)
      await user(()=>q('select aigc.ensure_credit_account($1)',[other]),other,'preview')
      const [preview]=await user(()=>q('select aigc.lock_credit_account_for_checkout($1) as payment_blocked',[other]),other,'preview')
      expect(preview.payment_blocked).toBe(false)
    } finally {
      await q("update aigc.credit_accounts set payment_blocked=false where user_id=$1 and scope='production'",[other])
    }
    const id=await makeOrder()
    await pay(id)
    const [refunded]=await user(()=>q(`update aigc.credit_orders set refund_requested=true,refund_reason=$2,
      refund_requested_at=coalesce(refund_requested_at,now()),updated_at=now() where id=$1 and status='paid' returning *`,[id,'不想要了']))
    expect(refunded).toMatchObject({id,refund_requested:true,refund_reason:'不想要了',status:'paid'})
    const pending=await makeOrder()
    const claimed=await worker(()=>q(`update aigc.credit_orders set last_checked_at=now()
      where id=$1 and scope='production' and (last_checked_at is null or last_checked_at<now()-interval '20 seconds') returning id`,[pending]))
    expect(claimed).toEqual([{id:pending}])
    expect(await worker(()=>q(`update aigc.credit_orders set last_checked_at=now()
      where id=$1 and scope='production' and (last_checked_at is null or last_checked_at<now()-interval '20 seconds') returning id`,[pending]))).toEqual([])
    const listed=await worker(()=>q(`select id from aigc.credit_orders where scope='production' and provider_mode='live'
      and status='pending' and checkout_id is not null and id=$1`,[pending]))
    expect(listed).toEqual([{id:pending}])
  })
  it('退款未发生时可以取消冻结，已发生现金退款不能再释放',async()=>{
    const id=await makeOrder(other);await pay(id)
    await user(()=>q('update aigc.credit_orders set refund_requested=true where id=$1',[id]),other)
    const key=`cancel:${id}`
    await q("select aigc.prepare_cash_refund($1,'production',199,$2,'审核员','未使用订单')",[id,key])
    expect((await q("select aigc.cancel_cash_refund($1,'production','审核员','核验平台未退款') as released",[key]))[0].released).toBe(100)
    expect((await q("select aigc.cancel_cash_refund($1,'production','审核员','重复取消') as released",[key]))[0].released).toBe(0)
  })
})
