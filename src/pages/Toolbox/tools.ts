import { i18n } from '@/i18n'
import zhToolbox from '@/i18n/locales/zh-CN/toolbox.json'

export interface ToolboxTool {
  slug: string
  label: string
}

export const TOOLBOX_TOOLS: ToolboxTool[] = [
  { slug: 'bg-remove', label: zhToolbox.tools['bg-remove'] },
  { slug: 'watermark', label: zhToolbox.tools.watermark },
  { slug: 'aspect-ratio', label: zhToolbox.tools['aspect-ratio'] },
  { slug: 'pipeline', label: zhToolbox.tools.pipeline },
]

export function getToolboxToolLabel(slug: string): string {
  switch (slug) {
    case 'bg-remove': return i18n.t('toolbox:tools.bg-remove')
    case 'watermark': return i18n.t('toolbox:tools.watermark')
    case 'aspect-ratio': return i18n.t('toolbox:tools.aspect-ratio')
    case 'pipeline': return i18n.t('toolbox:tools.pipeline')
    default: return slug
  }
}
