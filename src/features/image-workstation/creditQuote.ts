import type { PublicImageModel } from '@/services/api/imageModels'
import { Capability } from '@/types'
import { syncCreditPrice } from '@shared/billing'
import { creditQuote, imageCreditAmount, outpaintCreditAmount, type CreditQuote, type OutpaintQuoteGeometry } from '@/features/credits/quotes'

interface Request {
  capability: Capability
  params: unknown
  modelProfileId?: string
}

/** 重试沿用原请求参数；找不到原模型时不借用当前草稿的价格。 */
export function workstationRequestQuote(request: Request | undefined, models: PublicImageModel[], options: { mock?: boolean; loading?: boolean } = {}): CreditQuote {
  if (!request) return creditQuote(undefined, options)
  if (request.capability === Capability.Inpaint) return creditQuote(syncCreditPrice('erase'), { mock: options.mock })
  if (request.capability === Capability.Outpaint) {
    try {
      const credits = outpaintCreditAmount(request.params as OutpaintQuoteGeometry)
      return creditQuote(credits, { maximum: true, mock: options.mock && credits > 0 })
    } catch {
      return creditQuote(undefined, { mock: options.mock })
    }
  }
  const params = request.params as { count?: number; resolution?: string }
  const model = models.find(model => model.id === request.modelProfileId)
  return creditQuote(imageCreditAmount(model, params.count ?? 1, params.resolution ?? '2k'), options)
}
