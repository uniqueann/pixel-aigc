import { useMemo } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Layout, Menu, Typography } from 'antd'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { HELP_ARTICLES, findHelpArticle } from './articles'
import './help.css'

const { Sider, Content } = Layout
const { Title, Paragraph, Text } = Typography

const markdownComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => <Title level={2} className="help-title">{children}</Title>,
  h2: ({ children }: { children?: React.ReactNode }) => <Title level={4}>{children}</Title>,
  h3: ({ children }: { children?: React.ReactNode }) => <Title level={5}>{children}</Title>,
  p: ({ children }: { children?: React.ReactNode }) => <Paragraph>{children}</Paragraph>,
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
    <Typography.Link href={href} target={href?.startsWith('http') ? '_blank' : undefined} rel="noreferrer">
      {children}
    </Typography.Link>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <Text strong>{children}</Text>,
  code: ({ children }: { children?: React.ReactNode }) => <Text code>{children}</Text>,
}

function ArticleBody({ body }: { body: string }) {
  return (
    <div className="help-article">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>{body}</ReactMarkdown>
    </div>
  )
}

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
          <ArticleBody body={article.body} />
        </Content>
      </Layout>
    </div>
  )
}
