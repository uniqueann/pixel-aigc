import { CloudError } from '@/cloud/client'
import { uploadFailureText } from '@shared/upload-limits'
import { apiErrorCode, responseErrorText } from './apiErrorText'
import { useUserStore } from '@/store/useUserStore'
import { imageAuthHeader } from './image-transfer'
import { openCreditRecharge, recoverSyncResult, refreshBillingBalance } from './billing'
import type { SyncCreditQuote } from '@shared/billing'
import { syncTaskOrigin,saveReceipt,submittedReceipt,emitTaskCenter } from '@/features/task-center/receipts'

/** 网络中断只查询已有任务；不自动再次调用收费生成接口。 */
export async function postBilledSyncImage(path: string,body: Record<string,unknown>,quote: SyncCreditQuote & {owner:string},signal?: AbortSignal) {
  const checkOwner=()=>{
    if (useUserStore.getState().userId!==quote.owner) throw new CloudError(401,'账号已切换，请重新提交','ACCOUNT_CHANGED')
  }
  checkOwner()
  const headers=await imageAuthHeader()
  checkOwner()
  if(signal?.aborted) throw signal.reason ?? new DOMException('处理已取消','AbortError')
  const origin=body.origin??syncTaskOrigin(path)
  const payload={...body,...(origin?{origin}:{})}
  const receipt=saveReceipt('sync_credit',quote.requestId,origin as ReturnType<typeof syncTaskOrigin>)
  let response: Response
  try {
    response=await fetch(`/api/${path}`,{method:'POST',headers:{'Content-Type':'application/json',...headers},
      body:JSON.stringify({...payload,billing:{requestId:quote.requestId,priceVersion:quote.priceVersion,maxCredits:quote.maxCredits}}),
      signal:signal ?? AbortSignal.timeout(115_000)})
  } catch (error) {
    checkOwner()
    if(signal?.aborted && signal.reason?.name === 'AbortError') throw error
    const recovered=await recoverSyncResult(quote.requestId,quote.owner).catch(()=>null)
    if (recovered?.state === 'settled' && recovered.result) response=new Response(JSON.stringify(recovered.result),{headers:{'Content-Type':'application/json'}})
    else throw Object.assign(new Error(`请求中断，请在积分明细中查询已有操作结果；处理超时会退还积分（操作编号 ${quote.requestId}）`),{cause:error})
  } finally { void refreshBillingBalance(quote.owner).catch(()=>undefined);emitTaskCenter({type:'refresh'}) }
  checkOwner()
  if (!response.ok) {
    if(response.status>=500) {
      const recovered=await recoverSyncResult(quote.requestId,quote.owner).catch(()=>null)
      checkOwner()
      if(recovered?.state==='settled' && recovered.result) {submittedReceipt(receipt,quote.requestId);return new Response(JSON.stringify(recovered.result),{headers:{'Content-Type':'application/json'}})}
    }
    const payload: unknown = await response.json().catch(() => null)
    if (response.status === 402) openCreditRecharge()
    // 平台层 413 只有英文原文，换成可操作的中文结论。
    const message = responseErrorText(payload) ?? '图片操作失败'
    throw new CloudError(response.status, uploadFailureText(message, response.status) || message, apiErrorCode(payload))
  }
  submittedReceipt(receipt,quote.requestId)
  return response
}
