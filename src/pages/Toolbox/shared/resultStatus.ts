import { i18n } from '@/i18n'

export type ResultStatus = 'pending' | 'processing' | 'succeeded' | 'failed'

/** 结果网格与徽标共用的状态文案。 */
export function resultStatusLabel(status: ResultStatus) {
  return i18n.t(`toolbox:status.${status}`)
}
