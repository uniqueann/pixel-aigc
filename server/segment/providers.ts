import { tencentCiConfig } from '../tencent-ci.js'
import { tencentGoodsProvider } from './tencent-goods.js'
import type { SegmentProvider } from './types.js'

/** 当前只有商品抠图。点不中商品时由选区逻辑返回错误，不在路由里改叫另一家。 */
export function segmentProvider(): SegmentProvider | null {
  if (!tencentCiConfig()) return null
  return tencentGoodsProvider
}

export function segmentConfigured() {
  return segmentProvider() !== null
}
