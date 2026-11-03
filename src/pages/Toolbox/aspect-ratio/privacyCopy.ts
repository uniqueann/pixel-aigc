import type { FitStrategy } from './types'

/** 图片卡上的一句话隐私提示，必须与实际网络路径一致。 */
export function aspectRatioProcessingHint(strategy: FitStrategy) {
  if (strategy === 'crop') return '本机渲染，主体识别可能上传缩略图'
  if (strategy === 'outpaint') return '智能扩展会上传图片生成背景'
  return '图片仅在本机处理'
}

/** 预览区底部的策略说明。 */
export function aspectRatioPrivacyNote(strategy: FitStrategy) {
  if (strategy === 'crop') return '本机渲染，主体识别可能上传缩略图。'
  if (strategy === 'outpaint') return '智能扩展会上传图片生成背景。'
  return '图片在本机处理。'
}
