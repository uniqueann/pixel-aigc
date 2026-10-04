import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({sql:vi.fn(),signRead:vi.fn()}))
vi.mock('./db',()=>({withIdentity:async(_id:string,_email:string,fn:(sql:unknown)=>Promise<unknown>)=>fn(Object.assign(mocks.sql,{json:(value:unknown)=>value}))}))
vi.mock('./storage',()=>({signRead:mocks.signRead}))
import { withSyncCredits } from './sync-billing'
const user={id:'00000000-0000-4000-8000-000000000121',email:'user@example.com'}
const quote={requestId:'00000000-0000-4000-8000-000000000122',priceVersion:'aigc-sync-v1',maxCredits:5}
beforeEach(()=>{
  mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('reserve_sync_credits') ? [{job:{reused:false,credits_reserved:5}}] : [{settled:true}])
  mocks.signRead.mockResolvedValue({url:'https://saved.test/result',expiresAt:123})
})
afterEach(()=>vi.clearAllMocks())
describe('收费同步生成服务',()=>{
  it('余额不足和报价过期均不调用供应商',async()=>{
    const action=vi.fn()
    await expect(withSyncCredits(user,'erase',{...quote,priceVersion:'old'},{},action)).rejects.toMatchObject({code:'PRICE_CHANGED'})
    mocks.sql.mockResolvedValue([{job:{insufficient:true,required:5,balance:2}}])
    await expect(withSyncCredits(user,'erase',quote,{},action)).rejects.toMatchObject({status:402,code:'INSUFFICIENT_CREDITS'})
    expect(action).not.toHaveBeenCalled()
  })
  it('成功重放仅签名已存结果，不重复生成；处理中重放也不生成',async()=>{
    const action=vi.fn()
    mocks.sql.mockResolvedValue([{job:{reused:true,state:'settled',result:{objectKey:'temporary/result.jpg',mimeType:'image/jpeg',bytes:123,chargedCredits:5}}}])
    expect(await withSyncCredits(user,'erase',quote,{},action)).toMatchObject({objectKey:'temporary/result.jpg'})
    mocks.sql.mockResolvedValue([{job:{reused:true,state:'reserved'}}])
    await expect(withSyncCredits(user,'erase',quote,{},action)).rejects.toMatchObject({code:'SYNC_REQUEST_PENDING'})
    expect(action).not.toHaveBeenCalled()
  })
  it('供应商失败后主动退分，结算失败也留下退款补偿',async()=>{
    const failure=new Error('供应商失败'),action=vi.fn().mockRejectedValue(failure)
    await expect(withSyncCredits(user,'erase',quote,{sourceImageKey:'private'},action)).rejects.toBe(failure)
    expect(mocks.sql.mock.calls.some(([parts,...args])=>parts.join('').includes('finish_sync_credits') && parts.join('').includes(',null,') && args.includes('SERVER_ERROR'))).toBe(true)
  })
})
