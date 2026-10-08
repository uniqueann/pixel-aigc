import type { CreditCurrency, CreditPackId, PaymentProvider } from './billing.js'

export interface CreditDiscount {
  code: string
  id: string
  percentBps: number
  discountAmount: number
  payableAmount: number
}

export interface CreditDiscountPreview {
  provider: PaymentProvider
  currency: CreditCurrency
  code: string
  packs: Array<{
    packId: CreditPackId
    available: boolean
    amount: number
    message: string
    discount: CreditDiscount | null
  }>
}

/** 两个支付平台共用 EDM 已采用的代码格式。 */
export function normalizeCreditDiscountCode(value: string) {
  const code = value.trim().toUpperCase()
  if (code && !/^[A-Z0-9]{1,14}$/.test(code)) throw new Error('折扣码仅支持 1–14 位字母或数字')
  return code
}

export function discountPayableAmount(amount: number, percentBps: number) {
  return Math.round(amount * (10_000 - percentBps) / 10_000)
}

/** 不使用任意金额容差，只接受百分比计算结果的向上或向下取整。 */
export function matchesDiscountPayment(amount: number, percentBps: number, paid: number) {
  if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(percentBps)
    || percentBps <= 0 || percentBps >= 10_000 || !Number.isSafeInteger(paid) || paid <= 0) return false
  const exact = amount * (10_000 - percentBps) / 10_000
  return paid === Math.floor(exact) || paid === Math.ceil(exact)
}
