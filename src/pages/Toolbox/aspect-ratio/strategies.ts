import type { FitStrategy } from './types'

export const FIT_STRATEGIES: { label: string; value: FitStrategy }[] = [
  { label: '留白填充', value: 'letterbox' },
  { label: '智能裁剪', value: 'crop' },
  { label: '智能扩展', value: 'outpaint' },
]
