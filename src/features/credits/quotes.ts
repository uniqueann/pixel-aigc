import type { PublicImageModel } from '@/services/api/imageModels'
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

/** 有效张数还不是正整数时（例如尚未上传、张数被算成 0），报价改用当前选择。 */
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

/** 报价与提交共用整数几何和扩图轮次；没有留白时只处理本地图片。 */
export function outpaintCreditAmount(geometry: OutpaintQuoteGeometry): number {
  const { sourceSize, targetSize, originOffset } = geometry
  const padding = paddingAround(sourceSize.width, sourceSize.height, originOffset.x, originOffset.y, targetSize.width, targetSize.height)
  if (padding.left + padding.right + padding.top + padding.bottom <= 0) return 0
  return outpaintCreditPrice(sourceSize.width, sourceSize.height, padding)
}

export function creditQuoteLabel(quote: CreditQuote): string {
  if (quote.status === 'loading') return '报价加载中'
  if (quote.status === 'unavailable') return '报价暂不可用'
  if (quote.status === 'mock') return '模拟，不扣积分'
  if (quote.credits === 0) return quote.estimatedFree ? '预计免费' : '免费'
  return `${quote.maximum ? '最多 ' : ''}${quote.credits} 积分`
}

export function creditQuoteBlocked(quote?: CreditQuote): boolean {
  return quote?.status === 'loading' || quote?.status === 'unavailable'
}
