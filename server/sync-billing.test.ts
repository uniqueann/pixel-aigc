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
  it('原生成参数冲突返回409，来源本身不参与指纹',async()=>{
    const result={kind:'object' as const,objectKey:'temporary/result.png',mimeType:'image/png' as const,bytes:1,signed:{url:'https://test',expiresAt:123}}
    const action=vi.fn().mockResolvedValue(result)
    await withSyncCredits(user,'outpaint',quote,{sourceImageKey:'same',origin:{entry:'workstation',tool:'outpaint'}},action)
    await withSyncCredits(user,'outpaint',quote,{sourceImageKey:'same',origin:{entry:'toolbox',tool:'aspect-ratio'}},action)
    const hashes=mocks.sql.mock.calls.filter(([parts])=>parts.join('').includes('reserve_sync_credits')).map(([, ...args])=>args[2])
    expect(hashes[0]).toBe(hashes[1])
    mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>{if(parts.join('').includes('reserve_sync_credits'))throw Object.assign(new Error('同步请求编号冲突'),{code:'P0001'});return []})
    await expect(withSyncCredits(user,'outpaint',quote,{sourceImageKey:'changed'},action)).rejects.toMatchObject({status:409,code:'SYNC_REQUEST_CONFLICT'})
    expect(action).toHaveBeenCalledTimes(2)
  })

  it('供应商失败后主动退分，结算失败也留下退款补偿',async()=>{
    const failure=new Error('供应商失败'),action=vi.fn().mockRejectedValue(failure)
    await expect(withSyncCredits(user,'erase',quote,{sourceImageKey:'private'},action)).rejects.toBe(failure)
    expect(mocks.sql.mock.calls.some(([parts,...args])=>parts.join('').includes('finish_sync_credits') && parts.join('').includes(',null,') && args.includes('SERVER_ERROR'))).toBe(true)
  })
})
