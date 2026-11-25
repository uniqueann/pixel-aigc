import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import { useTranslation } from 'react-i18next'
import { activeLocale } from '@/i18n/format'
import { useThemeStore } from '@/store/useThemeStore'
import { findHelpArticle, getHelpArticles, loadHelpArticleBody } from './articles'
import { Markdown } from './markdown'
import './help.css'

const { Sider, Content } = Layout

export default function Help() {
  const { t } = useTranslation('help')
  const locale = activeLocale()
  const { article: slug } = useParams()
  const articles = getHelpArticles(locale)
  const article = findHelpArticle(slug, locale)
  const resolvedTheme = useThemeStore(state => state.resolvedTheme)
  const siderTheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const [loadedBody, setLoadedBody] = useState<{ slug: string; locale: string; body: string }>()

  useEffect(() => {
    if (locale !== 'en-US') return
    let active = true
    void loadHelpArticleBody(article.slug, locale).then((body) => {
      if (active) setLoadedBody({ slug: article.slug, locale, body })
    })
    return () => { active = false }
  }, [article.slug, locale])

  const body = locale === 'en-US' && loadedBody?.slug === article.slug && loadedBody.locale === locale
    ? loadedBody.body
    : article.body

  const menuItems = useMemo(() => {
    void t
    const groups = new Map<string, { label: string; key: string }[]>()
    for (const a of articles) {
      const list = groups.get(a.group) ?? []
      list.push({ label: a.title, key: a.slug })
      groups.set(a.group, list)
    }
    return [...groups.entries()].map(([group, children]) => ({
      key: `group-${group}`,
      label: group,
      type: 'group' as const,
      children: children.map((c) => ({
        key: c.key,
        label: <Link to={`/help/${c.key}`}>{c.label}</Link>,
      })),
    }))
  }, [articles, t])

  return (
    <div className="help-page">
      <Layout className="help-layout">
        <Sider
          width={220}
          className="help-sider"
          breakpoint="md"
          collapsedWidth={0}
          theme={siderTheme}
        >
          <Menu
            mode="inline"
            theme={siderTheme}
            selectedKeys={[article.slug]}
            items={menuItems}
            className="help-menu"
          />
        </Sider>
        <Content className="help-content">
          <Markdown body={body} />
        </Content>
      </Layout>
    </div>
  )
}
