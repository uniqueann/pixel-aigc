import { useEffect, useState } from 'react'
import { Avatar, Breadcrumb, Dropdown, Layout, Menu, Space } from 'antd'
import {
  AppstoreOutlined,
  MailOutlined,
  PictureOutlined,
  ToolOutlined,
  BgColorsOutlined,
  FolderOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV_META, SUB_ROUTE_LABELS } from '@/router/meta'
import { useUserStore } from '@/store/useUserStore'
import ErrorBoundary from '@/components/ErrorBoundary'

const { Sider, Content, Header } = Layout

const NAV_ITEMS = [
  { key: '/', icon: <AppstoreOutlined />, label: '工作台首页' },
  { key: '/email', icon: <MailOutlined />, label: '邮件助手' },
  { key: '/image-workstation', icon: <PictureOutlined />, label: '图片工作站' },
  { key: '/toolbox', icon: <ToolOutlined />, label: '工具箱' },
  { key: '/canvas', icon: <BgColorsOutlined />, label: '自由画布' },
  { key: '/assets', icon: <FolderOutlined />, label: '我的资产' },
]

/** 嵌套路径（如 /image-workstation/remove）也要能高亮到对应的顶层菜单项 */
function getActiveTopKey(pathname: string) {
  const first = pathname.split('/').filter(Boolean)[0]
  return first ? `/${first}` : '/'
}

export default function MainLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const [collapsed, setCollapsed] = useState(false)
  const credits = useUserStore((s) => s.credits)

  const segments = location.pathname.split('/').filter(Boolean)
  const topKey = getActiveTopKey(location.pathname)
  const topTitle = NAV_META[topKey] ?? NAV_META['/']
  const subTitle = segments.length > 1 ? SUB_ROUTE_LABELS[segments[0]]?.[segments[1]] : undefined

  useEffect(() => {
    document.title = subTitle ? `${subTitle} · ${topTitle} · AIGC 工作台` : `${topTitle} · AIGC 工作台`
  }, [topTitle, subTitle])

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        width={200}
        collapsible
        collapsed={collapsed}
        trigger={null}
        style={{ background: 'var(--color-surface)', borderRight: '1px solid var(--color-border)' }}
      >
        <div style={{ padding: '16px 20px', fontWeight: 600, fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden' }}>
          {collapsed ? 'AI' : 'AIGC 工作台'}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[topKey]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          style={{ borderInlineEnd: 'none' }}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: 'var(--color-surface)',
            borderBottom: '1px solid var(--color-border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 16px',
          }}
        >
          <Space size={14}>
            {collapsed ? (
              <MenuUnfoldOutlined onClick={() => setCollapsed(false)} style={{ fontSize: 16, cursor: 'pointer' }} />
            ) : (
              <MenuFoldOutlined onClick={() => setCollapsed(true)} style={{ fontSize: 16, cursor: 'pointer' }} />
            )}
            <Breadcrumb items={subTitle ? [{ title: topTitle }, { title: subTitle }] : [{ title: topTitle }]} />
          </Space>
          <Space size={16}>
            <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>积分 {credits}</span>
            <Dropdown
              menu={{
                items: [
                  { key: 'settings', label: '设置' },
                  { key: 'logout', label: '退出登录' },
                ],
              }}
            >
              <Avatar size={28} icon={<UserOutlined />} style={{ cursor: 'pointer' }} />
            </Dropdown>
          </Space>
        </Header>
        <Content style={{ padding: 20, overflow: 'auto' }}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Content>
      </Layout>
    </Layout>
  )
}
