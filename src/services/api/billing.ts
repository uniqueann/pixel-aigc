import { cloudRequest, CloudError } from '@/cloud/client'
import { i18n } from '@/i18n'
import { useUserStore } from '@/store/useUserStore'
import { type BillingCatalog, type CreditCurrency, type CreditOrder, type CreditPackId, type PaymentProvider, type SyncCreditOperation, type SyncCreditQuote } from '@shared/billing'
import type { SyncImageObjectResult } from '@shared/sync-image'
import type { CreditDiscountPreview } from '@shared/credit-discounts'

export const RECHARGE_EVENT = 'aigc:recharge'
export const SPEND_CONFIRM_EVENT = 'aigc:spend-confirm'
export const BILLING_REFRESH_EVENT = 'aigc:billing-refresh'
export function openCreditRecharge() { window.dispatchEvent(new Event(RECHARGE_EVENT)) }
export const getBillingCatalog = (owner: string, signal?: AbortSignal) => cloudRequest<BillingCatalog>('/credits/catalog','GET',undefined,{expectedUserId:owner,signal})
export const listCreditOrders = (owner: string) => cloudRequest<{items:CreditOrder[]}>('/credits/orders','GET',undefined,{expectedUserId:owner})
export const getCreditOrder = (id: string,owner: string) => cloudRequest<CreditOrder>(`/credits/orders/${id}`,'GET',undefined,{expectedUserId:owner})
export const previewCreditDiscount = (provider: PaymentProvider, code: string, expectedCurrency: CreditCurrency, owner: string, signal?: AbortSignal) =>
  cloudRequest<CreditDiscountPreview>('/credits/discount-preview','POST',{provider,code,expectedCurrency},{expectedUserId:owner,signal})
export const checkoutCredits = (packId: CreditPackId,provider: PaymentProvider,orderId: string,owner: string,expectedAmount:number,expectedCurrency:CreditCurrency,
  discount?: {discountCode: string; expectedPayableAmount: number}) =>
  cloudRequest<CreditOrder>('/credits/checkout','POST',{packId,provider,orderId,expectedAmount,expectedCurrency,...discount},{expectedUserId:owner})
export const requestCashRefund = (id: string,reason: string,owner: string) =>
  cloudRequest<CreditOrder>(`/credits/orders/${id}/refund-request`,'POST',{reason},{expectedUserId:owner})

export interface SpendConfirmation {
  owner: string; operation: SyncCreditOperation; required: number; balance: number;
  resolve: (approved: boolean) => void
}
export async function authorizeSyncQuote(operation: SyncCreditOperation,maxCredits: number): Promise<SyncCreditQuote & {owner: string}> {
  const owner=useUserStore.getState().userId
  if (!owner) throw new CloudError(401,i18n.t('errors:generic.authRequiredForOnlineImage'),'AUTH_REQUIRED')
  const catalog=await getBillingCatalog(owner)
  if (useUserStore.getState().userId!==owner) throw new CloudError(401,i18n.t('errors:generic.accountChangedResubmit'),'ACCOUNT_CHANGED')
  if (catalog.paymentBlocked) throw new CloudError(409,i18n.t('errors:codes.CREDIT_ACCOUNT_REVIEW'),'CREDIT_ACCOUNT_REVIEW')
  const amount=operation === 'bg-remove' && catalog.freeBgRemoveRemaining>0 ? 0 : maxCredits
  if (catalog.balance<amount) { openCreditRecharge(); throw new CloudError(402,i18n.t('errors:generic.insufficientCreditsAmount',{amount}),'INSUFFICIENT_CREDITS',{required:amount,balance:catalog.balance}) }
  if (amount>0) {
    const approved=await new Promise<boolean>(resolve=>window.dispatchEvent(new CustomEvent<SpendConfirmation>(SPEND_CONFIRM_EVENT,{detail:{owner,operation,required:amount,balance:catalog.balance,resolve}})))
    if (!approved) throw new DOMException(i18n.t('errors:generic.cancelledOperation',{tool:i18n.t(`credits:syncTools.${operation}` as never)}),'AbortError')
  }
  if (useUserStore.getState().userId!==owner) throw new CloudError(401,i18n.t('errors:generic.accountChangedResubmit'),'ACCOUNT_CHANGED')
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
  return cloudRequest<{state:'reserved'|'settled'|'refunded';result?:SyncImageObjectResult;resultExpired?:boolean;errorCode?:string}>(`/credits/sync/${id}`,'GET',undefined,{expectedUserId:owner})
}
