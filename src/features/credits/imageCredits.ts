import type { CreditQuote } from './quotes'

export const INSUFFICIENT_CREDITS_REASON = '积分不足'

/** 余额尚未读到、未登录、模拟生成或报价未就绪时不拦截。已知余额低于报价（含最多）才禁用。 */
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
