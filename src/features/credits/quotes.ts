import type { PublicImageModel } from '@/services/api/imageModels'
import { i18n } from '@/i18n'
import { outpaintCreditPrice } from '@shared/billing'
import { paddingAround } from '@shared/outpaint'

export type CreditQuote =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'mock' }
  | { status: 'ready'; credits: number; maximum?: boolean; estimatedFree?: boolean }

export function creditQuote(credits: number | undefined, options: { loading?: boolean; mock?: boolean; maximum?: boolean; estimatedFree?: boolean } = {}): CreditQuote {
  if (options.mock) return { status: 'mock' }
  if (options.loading) return { status: 'loading' }
  if (credits === undefined || !Number.isFinite(credits) || credits < 0) return { status: 'unavailable' }
  return { status: 'ready', credits, maximum: options.maximum, estimatedFree: options.estimatedFree }
}

export function imageCreditAmount(model: PublicImageModel | undefined, count: number, resolution: string): number | undefined {
  if (resolution !== '1k' && resolution !== '2k' && resolution !== '4k') return undefined
  const unitPrice = model?.pricing?.creditsPerImage?.[resolution]
  return typeof unitPrice === 'number' && Number.isFinite(unitPrice) && unitPrice >= 0 && Number.isInteger(count) && count > 0
    ? unitPrice * count : undefined
}

/** Fallback to selected count when effective count is not yet a positive integer (e.g. before uploads). */
export function positiveQuoteCount(effectiveCount: number, selectedCount: number): number | undefined {
  if (Number.isInteger(effectiveCount) && effectiveCount > 0) return effectiveCount
  if (Number.isInteger(selectedCount) && selectedCount > 0) return selectedCount
  return undefined
}

export interface OutpaintQuoteGeometry {
  sourceSize: { width: number; height: number }
  targetSize: { width: number; height: number }
  originOffset: { x: number; y: number }
}

/** Shared integer geometry calculation for outpaint pricing; local-only when there is no padding. */
export function outpaintCreditAmount(geometry: OutpaintQuoteGeometry): number {
  const { sourceSize, targetSize, originOffset } = geometry
  const padding = paddingAround(sourceSize.width, sourceSize.height, originOffset.x, originOffset.y, targetSize.width, targetSize.height)
  if (padding.left + padding.right + padding.top + padding.bottom <= 0) return 0
  return outpaintCreditPrice(sourceSize.width, sourceSize.height, padding)
}

export function creditQuoteLabel(quote: CreditQuote): string {
  if (quote.status === 'loading') return i18n.t('credits:quotes.loading')
  if (quote.status === 'unavailable') return i18n.t('credits:quotes.unavailable')
  if (quote.status === 'mock') return i18n.t('credits:quotes.mock')
  if (quote.credits === 0) return quote.estimatedFree ? i18n.t('credits:quotes.estimatedFree') : i18n.t('credits:quotes.free')
  return quote.maximum
    ? i18n.t('credits:quotes.maxCredits', { credits: quote.credits })
    : i18n.t('credits:quotes.credits', { credits: quote.credits })
}

export function creditQuoteBlocked(quote?: CreditQuote): boolean {
  return quote?.status === 'loading' || quote?.status === 'unavailable'
}
