import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({sql:vi.fn(),signRead:vi.fn(),headObject:vi.fn()}))
vi.mock('./db',()=>({withIdentity:async(_id:string,_email:string,fn:(sql:unknown)=>Promise<unknown>)=>fn(Object.assign(mocks.sql,{json:(value:unknown)=>value}))}))
vi.mock('./storage',()=>({signRead:mocks.signRead,headObject:mocks.headObject}))
import { SYNC_RESULT_RETENTION_MS } from '../shared/credits'
import { HttpError } from './errors'
import { getSyncCreditResult, withSyncCredits } from './sync-billing'
const user={id:'00000000-0000-4000-8000-000000000121',email:'user@example.com'}
const quote={requestId:'00000000-0000-4000-8000-000000000122',priceVersion:'aigc-sync-v1',maxCredits:5}
beforeEach(()=>{
  mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('reserve_sync_credits') ? [{job:{reused:false,credits_reserved:5}}] : [{settled:true}])
  mocks.signRead.mockResolvedValue({url:'https://saved.test/result',expiresAt:123})
  mocks.headObject.mockResolvedValue({bytes:123,contentType:'image/png'})
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

  it('7天内已结算且R2对象存在时校验并签名返回结果',async()=>{
    const updatedAt = new Date(Date.now() - 60_000).toISOString()
    mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('sync_credit_jobs')
      ? [{state:'settled',result:{objectKey:'temporary/result.png',mimeType:'image/png',bytes:123},error_code:null,updated_at:updatedAt}]
      : [])
    const res = await getSyncCreditResult(user, quote.requestId)
    expect(mocks.headObject).toHaveBeenCalledWith('temporary/result.png')
    expect(mocks.signRead).toHaveBeenCalledWith('temporary/result.png', 900)
    expect(res).toEqual({
      state: 'settled',
      result: { objectKey: 'temporary/result.png', mimeType: 'image/png', bytes: 123, url: 'https://saved.test/result', expiresAt: 123 },
    })
  })

  it('超过7天保留期时直接返回结果已过期，不请求R2或签名',async()=>{
    const expiredAt = new Date(Date.now() - SYNC_RESULT_RETENTION_MS - 1000).toISOString()
    mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('sync_credit_jobs')
      ? [{state:'settled',result:{objectKey:'temporary/result.png',mimeType:'image/png',bytes:123},error_code:null,updated_at:expiredAt}]
      : [])
    const res = await getSyncCreditResult(user, quote.requestId)
    expect(res).toEqual({ state: 'settled', resultExpired: true })
    expect(mocks.headObject).not.toHaveBeenCalled()
    expect(mocks.signRead).not.toHaveBeenCalled()
  })

  it('7天内R2对象404时返回结果已过期，R2临时错误仍抛出',async()=>{
    const recentAt = new Date(Date.now() - 60_000).toISOString()
    mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('sync_credit_jobs')
      ? [{state:'settled',result:{objectKey:'temporary/result.png',mimeType:'image/png',bytes:123},error_code:null,updated_at:recentAt}]
      : [])
    mocks.headObject.mockRejectedValueOnce(new HttpError(404, '对象不存在', 'OBJECT_NOT_FOUND'))
    await expect(getSyncCreditResult(user, quote.requestId)).resolves.toEqual({ state: 'settled', resultExpired: true })
    expect(mocks.signRead).not.toHaveBeenCalled()

    const r2Error = new Error('R2 timeout')
    mocks.headObject.mockRejectedValueOnce(r2Error)
    await expect(getSyncCreditResult(user, quote.requestId)).rejects.toBe(r2Error)
    expect(mocks.signRead).not.toHaveBeenCalled()
  })

  it('处理中或已退款任务直接返回状态，不请求R2或签名',async()=>{
    mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('sync_credit_jobs')
      ? [{state:'reserved',result:null,error_code:null,updated_at:new Date().toISOString()}]
      : [])
    await expect(getSyncCreditResult(user, quote.requestId)).resolves.toEqual({ state: 'reserved', errorCode: null })

    mocks.sql.mockImplementation(async(parts:TemplateStringsArray)=>parts.join('').includes('sync_credit_jobs')
      ? [{state:'refunded',result:null,error_code:'TASK_TIMEOUT',updated_at:new Date().toISOString()}]
      : [])
    await expect(getSyncCreditResult(user, quote.requestId)).resolves.toEqual({ state: 'refunded', errorCode: 'TASK_TIMEOUT' })
    expect(mocks.headObject).not.toHaveBeenCalled()
    expect(mocks.signRead).not.toHaveBeenCalled()
  })
})
