import type { VideoModelProfile } from '@shared/video-models'

function quotedCredits(credits: number | undefined): number | undefined {
  return typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 ? credits : undefined
}

/** 只读取接口返回的对应时长报价。缺价时返回 undefined，避免套用另一档时长或写成 0。 */
export function videoCreditsForDuration(model: Pick<VideoModelProfile, 'pricing'> | undefined, durationSeconds: number): number | undefined {
  const duration = durationSeconds === 10 ? 10 : durationSeconds === 5 ? 5 : undefined
  if (!model || !duration) return undefined
  return quotedCredits(model.pricing?.creditsPerVideo?.[duration])
}

export function videoCreditEstimateText(credits: number | undefined, mockGateway: boolean) {
  if (mockGateway) return '模拟生成，不消耗积分'
  const quote = quotedCredits(credits)
  return quote === undefined ? '积分预估暂不可用' : `预计消耗 ${quote} 积分`
}

export function videoCreditShortfallText(credits: number | undefined, balance: number, mockGateway: boolean) {
  const quote = quotedCredits(credits)
  if (mockGateway || quote === undefined || balance >= quote) return null
  return `积分不足，需要 ${quote} 积分，当前 ${balance}`
}

/** 真实模式下没有报价，或余额低于所选时长报价时，不能提交。声音不影响报价。 */
export function videoCreditBlocksSubmit(input: { mockGateway: boolean; loading: boolean; credits: number | undefined; balance: number }) {
  if (input.mockGateway || input.loading) return false
  const quote = quotedCredits(input.credits)
  return quote === undefined || input.balance < quote
}
