import { syncCreditPrice, type BillingCatalog } from '@shared/billing'
import { imagesNeedingRemoval } from '@/pages/Toolbox/bg-remove/batch'
import type { BatchImage as BgRemoveImage } from '@/pages/Toolbox/bg-remove/types'
import { expansionPlan } from '@/pages/Toolbox/aspect-ratio/expansion'
import type { AspectRatioSettings, BatchImage as AspectRatioImage } from '@/pages/Toolbox/aspect-ratio/types'
import { creditQuote, outpaintCreditAmount, type CreditQuote } from './quotes'

export function bgRemoveBatchQuote(images: BgRemoveImage[], catalog: BillingCatalog | undefined, options: { ids?: string[]; loading?: boolean; mock?: boolean } = {}): CreditQuote {
  const requests = imagesNeedingRemoval(images, options.ids).filter(image => !image.matte).length
  if (!requests) return creditQuote(0)
  return creditQuote(catalog ? Math.max(0, requests - catalog.freeBgRemoveRemaining) * syncCreditPrice('bg-remove') : undefined, {
    ...options, maximum: true, estimatedFree: true,
  })
}

export function aspectRatioBatchQuote(images: AspectRatioImage[], settings: AspectRatioSettings, targetWidth: number, targetHeight: number, options: { ids?: string[]; mock?: boolean } = {}): CreditQuote {
  if (settings.strategy !== 'outpaint') return creditQuote(0)
  try {
    const targets = images.filter(item => options.ids ? options.ids.includes(item.id) : item.status !== 'succeeded')
    const credits = targets.reduce((sum, item) => {
      const plan = expansionPlan(item.width, item.height, targetWidth, targetHeight, settings.outpaintOutputMode)
      return sum + (plan.mode === 'local' ? 0 : outpaintCreditAmount(plan))
    }, 0)
    return creditQuote(credits, { maximum: true, mock: credits > 0 && options.mock })
  } catch {
    return creditQuote(undefined)
  }
}
