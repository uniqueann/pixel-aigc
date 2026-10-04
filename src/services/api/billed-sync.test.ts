// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'
import { useUserStore } from '@/store/useUserStore'
const mocks=vi.hoisted(()=>({recover:vi.fn(),recharge:vi.fn(),refresh:vi.fn()}))
vi.mock('./billing',()=>({recoverSyncResult:mocks.recover,openCreditRecharge:mocks.recharge,refreshBillingBalance:mocks.refresh}))
vi.mock('./image-transfer',()=>({imageAuthHeader:async()=>({Authorization:'Bearer controlled'})}))
import { postBilledSyncImage } from './billed-sync'
const quote={owner:'owner',requestId:'00000000-0000-4000-8000-000000000211',maxCredits:5,priceVersion:'aigc-sync-v1'}
beforeEach(()=>{
  vi.clearAllMocks();useUserStore.getState().setUser('owner','free');mocks.refresh.mockResolvedValue(undefined);mocks.recover.mockResolvedValue(null)
  if(typeof AbortSignal.timeout!=='function') Object.defineProperty(AbortSignal,'timeout',{configurable:true,value:()=>new AbortController().signal})
})
afterEach(()=>vi.unstubAllGlobals())
describe('收费请求恢复与账号保护',()=>{
  it('网络失败只查询已有结果，不自动再次发起生成',async()=>{
    const fetch=vi.fn().mockRejectedValue(new TypeError('network failed'));vi.stubGlobal('fetch',fetch)
    mocks.recover.mockResolvedValue({state:'settled',result:{objectKey:'private/result',mimeType:'image/jpeg',url:'https://controlled.invalid/result'}})
    const response=await postBilledSyncImage('erase',{prompt:'移除物体'},quote)
    expect(fetch).toHaveBeenCalledTimes(1);expect(mocks.recover).toHaveBeenCalledWith(quote.requestId,'owner')
    expect(await response.json()).toMatchObject({objectKey:'private/result'})
  })
  it('402保留错误码并打开统一充值入口',async()=>{
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({error:'积分不足',code:'INSUFFICIENT_CREDITS'}),{status:402})))
    await expect(postBilledSyncImage('erase',{},quote)).rejects.toMatchObject({status:402,code:'INSUFFICIENT_CREDITS'})
    expect(mocks.recharge).toHaveBeenCalledTimes(1)
  })
  it('账号切换后拒绝发送旧操作，也不把旧结果交给新账号',async()=>{
    const fetch=vi.fn();vi.stubGlobal('fetch',fetch)
    useUserStore.getState().setUser('other','free')
    await expect(postBilledSyncImage('erase',{},quote)).rejects.toMatchObject({code:'ACCOUNT_CHANGED'});expect(fetch).not.toHaveBeenCalled()
    useUserStore.getState().setUser('owner','free')
    fetch.mockImplementation(async()=>{useUserStore.getState().setUser('other','free');return new Response('{}')})
    await expect(postBilledSyncImage('erase',{},quote)).rejects.toMatchObject({code:'ACCOUNT_CHANGED'})
  })
})
