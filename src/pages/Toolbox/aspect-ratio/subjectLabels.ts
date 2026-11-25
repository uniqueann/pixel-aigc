import { i18n } from '@/i18n'
import zhToolbox from '@/i18n/locales/zh-CN/toolbox.json'

export const SUBJECT_DETECTION_LABEL = zhToolbox.aspectRatio.subjectDetection

export function getSubjectDetectionLabel() {
  return i18n.t('toolbox:aspectRatio.subjectDetection')
}
