import { i18n } from '@/i18n'
import zhToolbox from '@/i18n/locales/zh-CN/toolbox.json'

export const LOCAL_TEMPLATE_LABEL = zhToolbox.aspectRatio.localTemplate

export function getLocalTemplateLabel() {
  return i18n.t('toolbox:aspectRatio.localTemplate')
}

export function getPlatformPresetLabel(presetId: string, fallback = presetId): string {
  switch (presetId) {
    case 'amazon-main': return i18n.t('toolbox:platforms.amazon-main')
    case 'temu-main': return i18n.t('toolbox:platforms.temu-main')
    case 'shopee-main': return i18n.t('toolbox:platforms.shopee-main')
    case 'tiktok-main': return i18n.t('toolbox:platforms.tiktok-main')
    default: return fallback
  }
}
