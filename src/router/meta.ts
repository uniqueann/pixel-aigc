import { i18n } from '@/i18n'
import { WORKSTATION_TOOLS } from '@/pages/ImageWorkstation/tools'
import { TOOLBOX_TOOLS } from '@/pages/Toolbox/tools'
import { CANVAS_MODES, VIDEO_REPLICATION_MODE } from '@/pages/FreeCanvas/modes'
import { HELP_ARTICLES } from '@/pages/Help/articles'

const NAV_ROUTE_KEYS = {
  '/': 'nav:routes.home',
  '/email': 'nav:routes.email',
  '/ecommerce': 'nav:routes.ecommerce',
  '/image-workstation': 'nav:routes.imageWorkstation',
  '/toolbox': 'nav:routes.toolbox',
  '/canvas': 'nav:routes.canvas',
  '/assets': 'nav:routes.assets',
  '/help': 'nav:routes.help',
} as const

export function getNavLabel(path: string): string {
  const key = NAV_ROUTE_KEYS[path as keyof typeof NAV_ROUTE_KEYS]
  return key ? i18n.t(key) : i18n.t('nav:routes.home')
}

const WORKSTATION_SLUGS = new Set(WORKSTATION_TOOLS.map(t => t.slug))
const TOOLBOX_SLUGS = new Set(TOOLBOX_TOOLS.map(t => t.slug))
const CANVAS_SLUGS = new Set([...CANVAS_MODES, VIDEO_REPLICATION_MODE].map(m => m.slug))
const HELP_SLUGS = new Set(HELP_ARTICLES.map(a => a.slug))

export function getSubRouteLabel(section: string, slug: string): string | undefined {
  if (section === 'image-workstation' && WORKSTATION_SLUGS.has(slug)) {
    return i18n.t(`workstation:tools.${slug}` as never)
  }
  if (section === 'toolbox' && TOOLBOX_SLUGS.has(slug)) {
    return i18n.t(`toolbox:tools.${slug}` as never)
  }
  if (section === 'canvas' && CANVAS_SLUGS.has(slug)) {
    return i18n.t(`canvas:modes.${slug}` as never)
  }
  if (section === 'help' && HELP_SLUGS.has(slug)) {
    return i18n.t(`help:articles.${slug}` as never)
  }
  return undefined
}
