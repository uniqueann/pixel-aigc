import { i18n } from '@/i18n'
import zhToolbox from '@/i18n/locales/zh-CN/toolbox.json'

export const SMART_SELECT_LABEL = zhToolbox.aspectRatio.smartSelect

export function getSmartSelectLabel() {
  return i18n.t('toolbox:aspectRatio.smartSelect')
}
