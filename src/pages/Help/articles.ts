import quickstart from '../../../docs/help/zh-CN/quickstart.md?raw'
import credits from '../../../docs/help/zh-CN/credits.md?raw'
import ecommerceSuite from '../../../docs/help/zh-CN/ecommerce-suite.md?raw'
import bgRemove from '../../../docs/help/zh-CN/bg-remove.md?raw'
import workstation from '../../../docs/help/zh-CN/workstation.md?raw'
import emailAssistant from '../../../docs/help/zh-CN/email-assistant.md?raw'
import faq from '../../../docs/help/zh-CN/faq.md?raw'
import contact from '../../../docs/help/zh-CN/contact.md?raw'
import toolbox from '../../../docs/help/zh-CN/toolbox.md?raw'
import canvas from '../../../docs/help/zh-CN/canvas.md?raw'
import { i18n } from '@/i18n'
import { activeLocale } from '@/i18n/format'
import zhHelp from '@/i18n/locales/zh-CN/help.json'
import type { Locale } from '@/i18n/types'

export interface HelpArticle {
  slug: string
  title: string
  /** Sidebar group heading */
  group: string
  body: string
}

type GroupId = keyof typeof zhHelp.groups
type ArticleSlug = keyof typeof zhHelp.articles

interface ArticleSpec {
  slug: ArticleSlug
  groupId: GroupId
  zhBody: string
}

const ARTICLE_SPECS: readonly ArticleSpec[] = [
  { slug: 'quickstart', groupId: 'quickstart', zhBody: quickstart },
  { slug: 'credits', groupId: 'billing', zhBody: credits },
  { slug: 'ecommerce-suite', groupId: 'guides', zhBody: ecommerceSuite },
  { slug: 'bg-remove', groupId: 'guides', zhBody: bgRemove },
  { slug: 'workstation', groupId: 'guides', zhBody: workstation },
  { slug: 'toolbox', groupId: 'guides', zhBody: toolbox },
  { slug: 'canvas', groupId: 'guides', zhBody: canvas },
  { slug: 'email-assistant', groupId: 'guides', zhBody: emailAssistant },
  { slug: 'faq', groupId: 'more', zhBody: faq },
  { slug: 'contact', groupId: 'more', zhBody: contact },
]

const enMarkdownLoaders = import.meta.glob<string>('../../../docs/help/en-US/*.md', {
  query: '?raw',
  import: 'default',
})

const enBodyCache = new Map<string, string>()

export const HELP_ARTICLE_GROUPS = [
  zhHelp.groups.quickstart,
  zhHelp.groups.guides,
  zhHelp.groups.billing,
  zhHelp.groups.more,
] as const

export const HELP_ARTICLES: HelpArticle[] = ARTICLE_SPECS.map((spec) => ({
  slug: spec.slug,
  title: zhHelp.articles[spec.slug],
  group: zhHelp.groups[spec.groupId],
  body: spec.zhBody,
}))

export function getHelpArticles(locale: Locale = activeLocale()): HelpArticle[] {
  return ARTICLE_SPECS.map((spec) => ({
    slug: spec.slug,
    title: i18n.t(`help:articles.${spec.slug}` as never, { lng: locale }),
    group: i18n.t(`help:groups.${spec.groupId}` as never, { lng: locale }),
    body: locale === 'en-US' ? (enBodyCache.get(spec.slug) ?? spec.zhBody) : spec.zhBody,
  }))
}

export function findHelpArticle(slug: string | undefined, locale: Locale = activeLocale()): HelpArticle {
  const articles = getHelpArticles(locale)
  return articles.find((a) => a.slug === slug) ?? articles[0]
}

export async function loadHelpArticleBody(slug: string, locale: Locale = activeLocale()): Promise<string> {
  const spec = ARTICLE_SPECS.find((a) => a.slug === slug) ?? ARTICLE_SPECS[0]
  if (locale !== 'en-US') return spec.zhBody
  const cached = enBodyCache.get(spec.slug)
  if (cached !== undefined) return cached
  const loader = enMarkdownLoaders[`../../../docs/help/en-US/${spec.slug}.md`]
  if (!loader) return spec.zhBody
  try {
    const body = await loader()
    enBodyCache.set(spec.slug, body)
    return body
  } catch {
    return spec.zhBody
  }
}
