import { planBailianOutpaint, type PixelPadding } from './outpaint.js'
import type { CreditDiscount } from './credit-discounts.js'

export const INITIAL_CREDITS = 30
export const SYNC_PRICE_VERSION = 'aigc-sync-v1'
export const BG_REMOVE_MONTHLY_FREE = 20
export type PaymentProvider = 'creem' | 'dodo'
export type CreditCurrency = 'USD' | 'CNY'
export type SyncCreditOperation = 'erase' | 'repaint' | 'outpaint' | 'bg-remove'
export const SYNC_TOOL_LABELS: Record<SyncCreditOperation, string> = {
  erase: '消除', repaint: '重绘', outpaint: '扩图', 'bg-remove': '商品抠图',
}

export const CREDIT_PACKS = [
  { id: 'starter', name: '体验包', credits: 100, CNY: 990, USD: 299 },
  { id: 'standard', name: '常用包', credits: 320, CNY: 2900, USD: 699 },
  { id: 'studio', name: '工作室包', credits: 1150, CNY: 9900, USD: 1999 },
] as const
export type CreditPackId = typeof CREDIT_PACKS[number]['id']

export function syncCreditPrice(operation: SyncCreditOperation, passes = 1) {
  if (operation === 'bg-remove') return 1
  if (operation === 'outpaint') {
    if (passes !== 1 && passes !== 2) throw new Error('扩图轮次无效')
    return passes * 5
  }
  return 5
}

export function outpaintCreditPrice(width: number, height: number, padding: PixelPadding) {
  return syncCreditPrice('outpaint', planBailianOutpaint(width, height, padding).passes.length)
}

export interface BillingCatalog {
  currency: CreditCurrency
  packs: Array<{ id: CreditPackId; name: string; credits: number; amount: number; providers: PaymentProvider[] }>
  providers: PaymentProvider[]
  priceVersion: string
  freeBgRemoveRemaining: number
  freeBgRemoveMonth: string
  balance: number
  paymentBlocked: boolean
}

export interface CreditOrder {
  id: string
  packId: CreditPackId
  provider: PaymentProvider
  amount: number
  currency: CreditCurrency
  credits: number
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'review'
  checkoutUrl: string | null
  refundRequested: boolean
  createdAt: string
  quotedAmount?: number
  paidAmount?: number | null
  quotedDiscount?: CreditDiscount | null
  paidDiscount?: CreditDiscount | null
}

export interface SyncCreditQuote {
  requestId: string
  priceVersion: string
  maxCredits: number
}

export function formatCreditPrice(amount: number, currency: CreditCurrency) {
  return `${currency === 'USD' ? '$' : '¥'}${(amount / 100).toFixed(2)}`
}
