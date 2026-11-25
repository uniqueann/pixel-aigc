import { i18n } from '@/i18n'
import zhToolbox from '@/i18n/locales/zh-CN/toolbox.json'
import type { FitStrategy } from './types'

export const FIT_STRATEGIES: { label: string; value: FitStrategy }[] = [
  { label: zhToolbox.aspectRatio.strategies.letterbox, value: 'letterbox' },
  { label: zhToolbox.aspectRatio.strategies.crop, value: 'crop' },
  { label: zhToolbox.aspectRatio.strategies.outpaint, value: 'outpaint' },
]

export function getFitStrategyLabel(value: FitStrategy): string {
  return i18n.t(`toolbox:aspectRatio.strategies.${value}`)
}
