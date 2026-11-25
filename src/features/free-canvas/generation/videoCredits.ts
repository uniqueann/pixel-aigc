import { videoModelCredits, type VideoModelProfile, type VideoResolution } from '@shared/video-models'
import { i18n } from '@/i18n'

function quotedCredits(credits: number | undefined): number | undefined {
  return typeof credits === 'number' && Number.isFinite(credits) && credits >= 0 ? credits : undefined
}

/** 只读取接口返回的对应时长报价。缺价时返回 undefined，避免套用另一档时长或写成 0。 */
export function videoCreditsForDuration(model: (Pick<VideoModelProfile, 'pricing'> & Partial<VideoModelProfile>) | undefined, durationSeconds: number, resolution?: VideoResolution): number | undefined {
  const duration = durationSeconds === 10 ? 10 : durationSeconds === 5 ? 5 : undefined
  if (!model || !duration) return undefined
  if (!model.resolution) return quotedCredits(model.pricing.creditsPerVideo?.[duration])
  return videoModelCredits(model as VideoModelProfile, resolution ?? model.resolution, duration)
}

export function videoCreditEstimateText(credits: number | undefined, mockGateway: boolean) {
  if (mockGateway) return i18n.t('canvas:video.credits.mock')
  const quote = quotedCredits(credits)
  return quote === undefined ? i18n.t('canvas:video.credits.unavailable') : i18n.t('canvas:video.credits.estimate', { credits: quote })
}

export function videoCreditShortfallText(credits: number | undefined, balance: number, mockGateway: boolean) {
  const quote = quotedCredits(credits)
  if (mockGateway || quote === undefined || balance >= quote) return null
  return i18n.t('canvas:video.credits.insufficient', { required: quote, balance })
}

/** 真实模式下没有报价，或余额低于所选时长报价时，不能提交。声音不影响报价。 */
export function videoCreditBlocksSubmit(input: { mockGateway: boolean; loading: boolean; credits: number | undefined; balance: number }) {
  if (input.mockGateway || input.loading) return false
  const quote = quotedCredits(input.credits)
  return quote === undefined || input.balance < quote
}
