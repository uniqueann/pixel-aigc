import { i18n } from '@/i18n'
import type { FitStrategy } from './types'

/** 图片卡上的一句话隐私提示，必须与实际网络路径一致。 */
export function aspectRatioProcessingHint(strategy: FitStrategy) {
  if (strategy === 'crop') return i18n.t('toolbox:aspectRatio.privacy.hintCrop')
  if (strategy === 'outpaint') return i18n.t('toolbox:aspectRatio.privacy.hintOutpaint')
  return i18n.t('toolbox:aspectRatio.privacy.hintLetterbox')
}

/** 预览区底部的策略说明。 */
export function aspectRatioPrivacyNote(strategy: FitStrategy) {
  if (strategy === 'crop') return i18n.t('toolbox:aspectRatio.privacy.noteCrop')
  if (strategy === 'outpaint') return i18n.t('toolbox:aspectRatio.privacy.noteOutpaint')
  return i18n.t('toolbox:aspectRatio.privacy.noteLetterbox')
}
