import { CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { imageAuthHeader } from './image-transfer'
import { openCreditRecharge, recoverSyncResult, refreshBillingBalance } from './billing'
import type { SyncCreditQuote } from '@shared/billing'

/** 网络中断只查询已有任务；不自动再次调用收费生成接口。 */
export async function postBilledSyncImage(path: string,body: Record<string,unknown>,quote: SyncCreditQuote & {owner:string},signal?: AbortSignal) {
  const checkOwner=()=>{
    if (useUserStore.getState().userId!==quote.owner) throw new CloudError(401,'账号已切换，请重新提交','ACCOUNT_CHANGED')
  }
  checkOwner()
  const headers=await imageAuthHeader()
  checkOwner()
  let response: Response
  try {
    response=await fetch(`/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},
      body:JSON.stringify({...body,billing:{requestId:quote.requestId,priceVersion:quote.priceVersion,maxCredits:quote.maxCredits}}),
      signal:signal ?? AbortSignal.timeout(115_000)})
  } catch (error) {
    checkOwner()
    if(signal?.aborted && signal.reason?.name === 'AbortError') throw error
    const recovered=await recoverSyncResult(quote.requestId,quote.owner).catch(()=>null)
    if (recovered?.state === 'settled' && recovered.result) response=new Response(JSON.stringify(recovered.result),{headers:{'Content-Type':'application/json'}})
    else throw Object.assign(new Error(`请求中断，请在积分明细中查询已有操作结果；处理超时会退还积分（操作编号 ${quote.requestId}）`),{cause:error})
  } finally { void refreshBillingBalance(quote.owner).catch(()=>undefined) }
  checkOwner()
  if (!response.ok) {
    if(response.status>=500) {
      const recovered=await recoverSyncResult(quote.requestId,quote.owner).catch(()=>null)
      checkOwner()
      if(recovered?.state==='settled' && recovered.result) return new Response(JSON.stringify(recovered.result),{headers:{'Content-Type':'application/json'}})
    }
    const payload=await response.json().catch(()=>null) as {error?:string;code?:string}|null
    if (response.status === 402) openCreditRecharge()
    throw new CloudError(response.status,payload?.error ?? '图片操作失败',payload?.code)
  }
  return response
}
