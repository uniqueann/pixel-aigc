import { cloudRequest, CloudError } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import { SYNC_TOOL_LABELS, type BillingCatalog, type CreditCurrency, type CreditOrder, type CreditPackId, type PaymentProvider, type SyncCreditOperation, type SyncCreditQuote } from '@shared/billing'
import type { SyncImageObjectResult } from '@shared/sync-image'

export const RECHARGE_EVENT = 'aigc:recharge'
export const SPEND_CONFIRM_EVENT = 'aigc:spend-confirm'
export const BILLING_REFRESH_EVENT = 'aigc:billing-refresh'
export function openCreditRecharge() { window.dispatchEvent(new Event(RECHARGE_EVENT)) }
export const getBillingCatalog = (owner: string, signal?: AbortSignal) => cloudRequest<BillingCatalog>('/credits/catalog','GET',undefined,{expectedUserId:owner,signal})
export const listCreditOrders = (owner: string) => cloudRequest<{items:CreditOrder[]}>('/credits/orders','GET',undefined,{expectedUserId:owner})
export const getCreditOrder = (id: string,owner: string) => cloudRequest<CreditOrder>(`/credits/orders/${id}`,'GET',undefined,{expectedUserId:owner})
export const checkoutCredits = (packId: CreditPackId,provider: PaymentProvider,orderId: string,owner: string,expectedAmount:number,expectedCurrency:CreditCurrency) =>
  cloudRequest<CreditOrder>('/credits/checkout','POST',{packId,provider,orderId,expectedAmount,expectedCurrency},{expectedUserId:owner})
export const requestCashRefund = (id: string,reason: string,owner: string) =>
  cloudRequest<CreditOrder>(`/credits/orders/${id}/refund-request`,'POST',{reason},{expectedUserId:owner})

export interface SpendConfirmation {
  owner: string; operation: SyncCreditOperation; required: number; balance: number;
  resolve: (approved: boolean) => void
}
export async function authorizeSyncQuote(operation: SyncCreditOperation,maxCredits: number): Promise<SyncCreditQuote & {owner: string}> {
  const owner=useUserStore.getState().userId
  if (!owner) throw new CloudError(401,'请先登录再使用在线图片服务','AUTH_REQUIRED')
  const catalog=await getBillingCatalog(owner)
  if (useUserStore.getState().userId!==owner) throw new CloudError(401,'账号已切换，请重新提交','ACCOUNT_CHANGED')
  if (catalog.paymentBlocked) throw new CloudError(409,'积分账户需要人工核对，请联系支持','CREDIT_ACCOUNT_REVIEW')
  const amount=operation === 'bg-remove' && catalog.freeBgRemoveRemaining>0 ? 0 : maxCredits
  if (catalog.balance<amount) { openCreditRecharge(); throw new CloudError(402,`积分不足，本次最多需要 ${amount} 积分`,'INSUFFICIENT_CREDITS') }
  if (amount>0) {
    const approved=await new Promise<boolean>(resolve=>window.dispatchEvent(new CustomEvent<SpendConfirmation>(SPEND_CONFIRM_EVENT,{detail:{owner,operation,required:amount,balance:catalog.balance,resolve}})))
    if (!approved) throw new DOMException(`已取消${SYNC_TOOL_LABELS[operation]}`,'AbortError')
  }
  if (useUserStore.getState().userId!==owner) throw new CloudError(401,'账号已切换，请重新提交','ACCOUNT_CHANGED')
  return {requestId:crypto.randomUUID(),priceVersion:catalog.priceVersion,maxCredits:amount,owner}
}
export async function refreshBillingBalance(owner: string) {
  const catalog=await getBillingCatalog(owner)
  if (useUserStore.getState().userId===owner) {
    useUserStore.getState().setCredits(catalog.balance)
    window.dispatchEvent(new Event(BILLING_REFRESH_EVENT))
  }
}
export async function recoverSyncResult(id: string,owner: string) {
  return cloudRequest<{state:'reserved'|'settled'|'refunded';result?:SyncImageObjectResult;errorCode?:string}>(`/credits/sync/${id}`,'GET',undefined,{expectedUserId:owner})
}
