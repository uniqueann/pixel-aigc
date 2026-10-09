import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout, Menu } from 'antd'
import { HELP_ARTICLES, findHelpArticle } from './articles'
import { Markdown } from './markdown'
import './help.css'

const { Sider, Content } = Layout

export default function Help() {
  const { article: slug } = useParams()
  const article = findHelpArticle(slug)

  const menuItems = useMemo(() => {
    const groups = new Map<string, { label: string; key: string }[]>()
    for (const a of HELP_ARTICLES) {
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
  }, [])

  return (
    <div className="help-page">
      <Layout className="help-layout">
        <Sider width={220} className="help-sider" breakpoint="md" collapsedWidth={0}>
          <Menu mode="inline" selectedKeys={[article.slug]} items={menuItems} className="help-menu" />
        </Sider>
        <Content className="help-content">
          <Markdown body={article.body} />
        </Content>
      </Layout>
    </div>
  )
}
