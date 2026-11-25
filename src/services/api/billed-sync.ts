import { CloudError } from '@/cloud/client'
import { i18n } from '@/i18n'
import { extractErrorExtra, extractRequestId, translateApiError } from '@/i18n/apiErrors'
import { apiErrorCode, responseErrorText } from './apiErrorText'
import { useUserStore } from '@/store/useUserStore'
import { imageAuthHeader } from './image-transfer'
import { openCreditRecharge, recoverSyncResult, refreshBillingBalance } from './billing'
import type { SyncCreditQuote } from '@shared/billing'
import { syncTaskOrigin,saveReceipt,submittedReceipt,emitTaskCenter } from '@/features/task-center/receipts'

/** 网络中断只查询已有任务；不自动再次调用收费生成接口。 */
export async function postBilledSyncImage(path: string,body: Record<string,unknown>,quote: SyncCreditQuote & {owner:string},signal?: AbortSignal) {
  const checkOwner=()=>{
    if (useUserStore.getState().userId!==quote.owner) throw new CloudError(401,i18n.t('errors:generic.accountChangedResubmit'),'ACCOUNT_CHANGED')
  }
  checkOwner()
  const headers=await imageAuthHeader()
  checkOwner()
  if(signal?.aborted) throw signal.reason ?? new DOMException(i18n.t('errors:client.processingCancelled'),'AbortError')
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
    else throw Object.assign(new Error(i18n.t('errors:generic.syncInterrupted',{requestId:quote.requestId})),{cause:error})
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
    const code = apiErrorCode(payload)
    const extra = extractErrorExtra(payload)
    // Proxy 413 responses arrive with raw English text; translateApiError maps them to localized copy.
    const message = translateApiError({
      code,
      extra,
      message: responseErrorText(payload),
      status: response.status,
      requestId: extractRequestId(payload),
      fallback: i18n.t('errors:generic.syncImageFailed'),
    })
    throw new CloudError(response.status, message, code, extra)
  }
  submittedReceipt(receipt,quote.requestId)
  return response
}
