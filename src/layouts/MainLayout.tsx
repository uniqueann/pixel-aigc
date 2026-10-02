import { authEnabled, supabase } from '@/cloud/client'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { useCloudStore } from '@/cloud/sync'
import { useEffect, useState } from 'react'
import { Alert, App, Avatar, Breadcrumb, Button, Dropdown, Layout, Menu, Space } from 'antd'
import {
  AppstoreOutlined,
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
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV_META, SUB_ROUTE_LABELS } from '@/router/meta'
import { useUserStore } from '@/store/useUserStore'
import ErrorBoundary from '@/components/ErrorBoundary'
import CreditsLedgerDrawer from '@/features/credits/CreditsLedgerDrawer'
import SettingsDialog from '@/layouts/SettingsDialog'
import { usePreferencesStore } from '@/features/preferences/store'
import { readSidebarState, writeSidebarState } from '@/features/preferences/storage'
import { isPreferencePage, resolveStartPage } from '@shared/preferences'

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
  const [startupTarget, setStartupTarget] = useState(() => location.pathname === '/' && !location.search ? resolveStartPage(usePreferencesStore.getState().preferences) : '/')
  useEffect(() => {
    if (startupTarget !== '/' && location.pathname !== '/') queueMicrotask(() => setStartupTarget('/'))
  }, [location.pathname, startupTarget])
  if (location.pathname === '/' && startupTarget !== '/') return <Navigate to={startupTarget} replace />
  return <MainLayoutContent />
}

function MainLayoutContent() {
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (window.matchMedia('(max-width: 720px)').matches) return false
    const state = usePreferencesStore.getState()
    return state.preferences.workbench.rememberSidebar ? readSidebarState(state.owner) ?? true : true
  })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const account = useUserStore((s) => s.account)
  const credits = useUserStore((s) => s.credits)
  const preferencesError = usePreferencesStore(state => state.error)
  const toggleSidebar = (open: boolean) => {
    setSidebarOpen(open)
    const state = usePreferencesStore.getState()
    if (state.preferences.workbench.rememberSidebar && !window.matchMedia('(max-width: 720px)').matches) writeSidebarState(state.owner, open)
  }

  const segments = location.pathname.split('/').filter(Boolean)
  const topKey = getActiveTopKey(location.pathname)
  const topTitle = NAV_META[topKey] ?? NAV_META['/']
  const subTitle = segments.length > 1 ? SUB_ROUTE_LABELS[segments[0]]?.[segments[1]] : undefined

  useEffect(() => {
    document.title = subTitle ? `${subTitle} · ${topTitle} · AIGC 工作台` : `${topTitle} · AIGC 工作台`
  }, [topTitle, subTitle])

  useEffect(() => {
    if (isPreferencePage(location.pathname)) usePreferencesStore.getState().update({ recent: { page: location.pathname } })
  }, [location.pathname])

  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)')
    const onChange = (event: MediaQueryListEvent) => {
      setNarrowScreen(event.matches)
      if (event.matches) setSidebarOpen(false)
    }
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const handleAccountMenu = ({ key }: { key: string }) => {
    if (key === 'settings' || key === 'personalization') {
      setSettingsSection(key === 'personalization' ? 'personalization' : 'general')
      setSettingsOpen(true)
      void usePreferencesStore.getState().refresh()
      return
    }
    if (key === 'logout' && authEnabled) {
      void (async () => {
        try { await flushProject() } catch { message.warning('本地项目保存未完成，请稍后检查当前账号的本地存档') }
        if (useCloudStore.getState().busy) message.warning('云端同步可能尚未完成；本地存档会保留在当前账号下')
        useUserStore.getState().setAccount(null)
        const { error } = await supabase!.auth.signOut({ scope: 'local' })
        if (error) throw error
        window.location.replace('/login')
      })().catch(error => message.error(String(error.message)))
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
              <button className="sidebar-icon-button" type="button" onClick={() => toggleSidebar(false)} aria-label="收起侧边栏">
                <MenuFoldOutlined />
              </button>
            </>
          ) : (
            <button className="collapsed-brand-toggle" type="button" onClick={() => toggleSidebar(true)} aria-label="展开侧边栏">
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
                { key: 'personalization', icon: <UserOutlined />, label: '个性化' },
                { key: 'settings', icon: <SettingOutlined />, label: '设置' },
                { key: 'help', icon: <QuestionCircleOutlined />, label: '帮助与支持' },
                { type: 'divider' },
                { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
              ],
            }}
          >
            <button className="account-trigger" type="button">
              <Avatar size={34} src={account?.avatarUrl ?? undefined} icon={account ? undefined : <UserOutlined />}>{account && !account.avatarUrl ? account.displayName.slice(0,1) : null}</Avatar>
              {sidebarOpen ? (
                <span className="account-trigger-copy">
                  <span className="account-name">{account?.displayName ?? '个人账号'}</span>
                  <span className="account-meta">{account?.email ?? '本地模式'}</span>
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
            {account && (
              <button
                type="button"
                className="credits-trigger"
                aria-label={`积分余额 ${credits}`}
                onClick={() => setCreditsOpen(true)}
              >
                积分 {credits}
              </button>
            )}
          </Space>
        </Header>
        <Content className="app-main-content">
          {preferencesError ? <Alert className="preferences-global-error" type="warning" showIcon message={preferencesError} action={<Button size="small" onClick={() => void usePreferencesStore.getState().retry()}>重试同步</Button>} /> : null}
          <ErrorBoundary key={location.pathname}>
            <Outlet context={{ openModelSettings: () => { setSettingsSection('models'); setSettingsOpen(true) } }} />
          </ErrorBoundary>
        </Content>
      </Layout>
      <CreditsLedgerDrawer open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        section={settingsSection}
        narrow={narrowScreen}
        onClose={() => setSettingsOpen(false)}
        onSectionChange={setSettingsSection}
      />
    </Layout>
  )
}
