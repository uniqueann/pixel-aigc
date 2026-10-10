import quickstart from '../../../docs/help/quickstart.md?raw'
import credits from '../../../docs/help/credits.md?raw'
import bgRemove from '../../../docs/help/bg-remove.md?raw'
import workstation from '../../../docs/help/workstation.md?raw'
import emailAssistant from '../../../docs/help/email-assistant.md?raw'
import faq from '../../../docs/help/faq.md?raw'
import contact from '../../../docs/help/contact.md?raw'
import toolbox from '../../../docs/help/toolbox.md?raw'
import canvas from '../../../docs/help/canvas.md?raw'

export interface HelpArticle {
  slug: string
  title: string
  /** 左侧目录分组 */
  group: string
  body: string
}

export const HELP_ARTICLE_GROUPS = ['快速上手', '使用指南', '费用与账号', '更多'] as const

export const HELP_ARTICLES: HelpArticle[] = [
  { slug: 'quickstart', title: '快速上手', group: '快速上手', body: quickstart },
  { slug: 'credits', title: '积分与计费说明', group: '费用与账号', body: credits },
  { slug: 'bg-remove', title: '智能抠图使用指南', group: '使用指南', body: bgRemove },
  { slug: 'workstation', title: '图片工作站总览', group: '使用指南', body: workstation },
  { slug: 'toolbox', title: '工具箱使用指南', group: '使用指南', body: toolbox },
  { slug: 'canvas', title: '自由画布使用指南', group: '使用指南', body: canvas },
  { slug: 'email-assistant', title: '邮件助手与积分计费', group: '使用指南', body: emailAssistant },
  { slug: 'faq', title: '常见问题', group: '更多', body: faq },
  { slug: 'contact', title: '联系支持', group: '更多', body: contact },
]

export function findHelpArticle(slug: string | undefined): HelpArticle {
  return HELP_ARTICLES.find((a) => a.slug === slug) ?? HELP_ARTICLES[0]
}
