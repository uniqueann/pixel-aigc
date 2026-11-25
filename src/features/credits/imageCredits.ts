import { i18n } from '@/i18n'
import zhCredits from '@/i18n/locales/zh-CN/credits.json'
import type { CreditQuote } from './quotes'

export const INSUFFICIENT_CREDITS_REASON = zhCredits.quotes.insufficientShort

export function insufficientCreditsReason() {
  return i18n.t('credits:quotes.insufficientShort')
}

/** Skip blocking before balance/auth loads, in mock mode, or when quote is not ready. */
export function imageCreditBlocksSubmit(input: {
  mock?: boolean
  quote?: CreditQuote
  balance: number | undefined
}) {
  if (input.mock) return false
  if (!input.quote || input.quote.status !== 'ready' || input.quote.credits <= 0) return false
  if (input.balance === undefined) return false
  return input.balance < input.quote.credits
}
