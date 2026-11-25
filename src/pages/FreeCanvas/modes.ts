import { i18n } from '@/i18n'
import zhCanvas from '@/i18n/locales/zh-CN/canvas.json'

export interface CanvasMode {
  slug: string
  label: string
}

export const CANVAS_MODES: CanvasMode[] = [
  { slug: 'text-to-image', label: zhCanvas.modes['text-to-image'] },
  { slug: 'text-to-video', label: zhCanvas.modes['text-to-video'] },
]

export const VIDEO_REPLICATION_MODE = {
  slug: 'video-replication',
  label: zhCanvas.modes['video-replication'],
} as const

export function canvasModeLabel(slug: string): string {
  switch (slug) {
    case 'text-to-image':
      return i18n.t('canvas:modes.text-to-image')
    case 'text-to-video':
      return i18n.t('canvas:modes.text-to-video')
    case 'video-replication':
      return i18n.t('canvas:modes.video-replication')
    default:
      return slug
  }
}
