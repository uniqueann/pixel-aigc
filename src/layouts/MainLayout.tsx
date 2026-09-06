import { useEffect, useState } from 'react'
import { App, Avatar, Breadcrumb, Dropdown, Layout, Menu, Modal, Space, Switch } from 'antd'
import {
  AppstoreOutlined,
  CrownOutlined,
  MailOutlined,
  PictureOutlined,
  ToolOutlined,
  BgColorsOutlined,
  FolderOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
  UserOutlined,
} from '@ant-design/icons'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV_META, SUB_ROUTE_LABELS } from '@/router/meta'
import { useUserStore } from '@/store/useUserStore'
import ErrorBoundary from '@/components/ErrorBoundary'

const { Sider, Content, Header } = Layout

const SETTINGS_ITEMS = [
  { key: 'general', label: '通用' },
  { key: 'personalization', label: '个性化' },
  { key: 'data', label: '数据控制' },
  { key: 'account', label: '账号' },
]

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
  const { message } = App.useApp()
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const credits = useUserStore((s) => s.credits)
  const userId = useUserStore((s) => s.userId)
  const tier = useUserStore((s) => s.tier)

  const segments = location.pathname.split('/').filter(Boolean)
  const topKey = getActiveTopKey(location.pathname)
  const topTitle = NAV_META[topKey] ?? NAV_META['/']
  const subTitle = segments.length > 1 ? SUB_ROUTE_LABELS[segments[0]]?.[segments[1]] : undefined

  useEffect(() => {
    document.title = subTitle ? `${subTitle} · ${topTitle} · AIGC 工作台` : `${topTitle} · AIGC 工作台`
  }, [topTitle, subTitle])

  const handleAccountMenu = ({ key }: { key: string }) => {
    if (key === 'settings') {
      setSettingsSection('general')
      setSettingsOpen(true)
      return
    }
    message.info(key === 'logout' ? '退出登录功能尚未接入' : '该功能将在后续版本开放')
  }

  return (
    <Layout style={{ height: '100vh' }}>
      <Sider
        width={260}
        collapsedWidth={68}
        collapsible
        collapsed={!sidebarOpen}
        trigger={null}
        className="app-sidebar"
      >
        <div className={`app-sidebar-header${sidebarOpen ? '' : ' is-collapsed'}`}>
          {sidebarOpen ? (
            <>
              <button className="app-brand" type="button" onClick={() => navigate('/')} aria-label="返回工作台首页">
                <span className="app-brand-mark">P</span>
                <span>Pixel AIGC</span>
              </button>
              <button className="sidebar-icon-button" type="button" onClick={() => setSidebarOpen(false)} aria-label="收起侧边栏">
                <MenuFoldOutlined />
              </button>
            </>
          ) : (
            <button className="collapsed-brand-toggle" type="button" onClick={() => setSidebarOpen(true)} aria-label="展开侧边栏">
              <span className="app-brand-mark collapsed-brand-mark">P</span>
              <MenuUnfoldOutlined className="collapsed-brand-icon" />
            </button>
          )}
        </div>
        <Menu
          mode="inline"
          inlineCollapsed={!sidebarOpen}
          selectedKeys={[topKey]}
          items={NAV_ITEMS}
          onClick={({ key }) => navigate(key)}
          className="app-sidebar-menu"
        />
        <div className="app-sidebar-account">
          <Dropdown
            trigger={['click']}
            placement="topLeft"
            align={sidebarOpen ? undefined : { offset: [52, 0] }}
            overlayClassName="account-dropdown"
            menu={{
              onClick: handleAccountMenu,
              items: [
                { key: 'upgrade', icon: <CrownOutlined />, label: '升级方案' },
                { key: 'personalization', icon: <UserOutlined />, label: '个性化' },
                { key: 'settings', icon: <SettingOutlined />, label: '设置' },
                { key: 'help', icon: <QuestionCircleOutlined />, label: '帮助与支持' },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
              ],
            }}
          >
            <button className="account-trigger" type="button">
              <Avatar size={34} icon={<UserOutlined />} />
              {sidebarOpen ? (
                <span className="account-trigger-copy">
                  <span className="account-name">{userId ?? '个人账号'}</span>
                  <span className="account-meta">{tier.toUpperCase()} · 积分 {credits}</span>
                </span>
              ) : null}
            </button>
          </Dropdown>
        </div>
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space size={14}>
            <Breadcrumb items={subTitle ? [{ title: topTitle }, { title: subTitle }] : [{ title: topTitle }]} />
          </Space>
        </Header>
        <Content style={{ padding: 20, overflow: 'auto' }}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </Content>
      </Layout>
      <Modal
        open={settingsOpen}
        onCancel={() => setSettingsOpen(false)}
        footer={null}
        width={760}
        title="设置"
        centered
        className="settings-modal"
      >
        <div className="settings-layout">
          <Menu
            mode="inline"
            selectedKeys={[settingsSection]}
            items={SETTINGS_ITEMS}
            onClick={({ key }) => setSettingsSection(key)}
            className="settings-menu"
          />
          <div className="settings-content">
            <SettingsContent section={settingsSection} credits={credits} tier={tier} />
          </div>
        </div>
      </Modal>
    </Layout>
  )
}

function SettingsContent({ section, credits, tier }: { section: string; credits: number; tier: string }) {
  if (section === 'personalization') {
    return <SettingsPanel title="个性化" description="管理生成偏好、默认风格和工作台习惯。" />
  }
  if (section === 'data') {
    return (
      <SettingsPanel title="数据控制" description="管理项目数据与产品改进选项。">
        <SettingRow label="帮助改进 Pixel AIGC" detail="允许使用匿名使用数据改进产品体验">
          <Switch defaultChecked />
        </SettingRow>
      </SettingsPanel>
    )
  }
  if (section === 'account') {
    return (
      <SettingsPanel title="账号" description="查看当前方案和账号资源。">
        <SettingRow label="当前方案" detail={tier.toUpperCase()}><span>{credits} 积分</span></SettingRow>
      </SettingsPanel>
    )
  }
  return (
    <SettingsPanel title="通用" description="调整界面显示和常用体验。">
      <SettingRow label="外观" detail="跟随当前工作台主题"><span>深色</span></SettingRow>
      <SettingRow label="语言" detail="界面显示语言"><span>简体中文</span></SettingRow>
    </SettingsPanel>
  )
}

function SettingsPanel({ title, description, children }: { title: string; description: string; children?: React.ReactNode }) {
  return (
    <section>
      <h2>{title}</h2>
      <p className="settings-description">{description}</p>
      <div className="settings-rows">{children}</div>
    </section>
  )
}

function SettingRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="setting-row">
      <span><strong>{label}</strong><small>{detail}</small></span>
      {children}
    </div>
  )
}
