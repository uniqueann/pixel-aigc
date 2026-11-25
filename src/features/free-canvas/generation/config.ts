import { i18n } from '@/i18n'

export interface ImageSizePreset {
  key: string
  label: string
  width: number
  height: number
  tooltip?: string
}

export function getAspectRatioTooltip(key: string): string {
  switch (key) {
    case '1:1':
      return i18n.t('canvas:aspectRatios.1:1')
    case '4:3':
      return i18n.t('canvas:aspectRatios.4:3')
    case '3:4':
      return i18n.t('canvas:aspectRatios.3:4')
    case '16:9':
      return i18n.t('canvas:aspectRatios.16:9')
    case '9:16':
      return i18n.t('canvas:aspectRatios.9:16')
    case '3:2':
      return i18n.t('canvas:aspectRatios.3:2')
    case '2:3':
      return i18n.t('canvas:aspectRatios.2:3')
    default:
      return key
  }
}

export const IMAGE_SIZE_PRESETS: ImageSizePreset[] = [
  { key: '1:1', label: '1:1', width: 1024, height: 1024, get tooltip() { return getAspectRatioTooltip('1:1') } },
  { key: '4:3', label: '4:3', width: 1024, height: 768, get tooltip() { return getAspectRatioTooltip('4:3') } },
  { key: '3:4', label: '3:4', width: 768, height: 1024, get tooltip() { return getAspectRatioTooltip('3:4') } },
  { key: '16:9', label: '16:9', width: 1280, height: 720, get tooltip() { return getAspectRatioTooltip('16:9') } },
  { key: '9:16', label: '9:16', width: 720, height: 1280, get tooltip() { return getAspectRatioTooltip('9:16') } },
]
