import { authEnabled, supabase } from '@/cloud/client'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { useCloudStore } from '@/cloud/sync'
import { useEffect, useState } from 'react'
import { App, Avatar, Breadcrumb, Dropdown, Layout, Menu } from 'antd'
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
import CreditSpendGate from '@/features/credits/CreditSpendGate'
import { getCreditOrder, refreshBillingBalance, RECHARGE_EVENT } from '@/services/api/billing'
import SettingsDialog from '@/layouts/SettingsDialog'
import { CanvasProjectCrumb, CanvasProjectMenu } from '@/layouts/CanvasProjectHeader'
import { isCanvasRoute } from '@/layouts/projectActions'
import { usePreferencesStore } from '@/features/preferences/store'
import PreferencesSyncAlert from '@/features/preferences/PreferencesSyncAlert'
import { readSidebarState, writeSidebarState } from '@/features/preferences/storage'
import { isPreferencePage, resolveStartPage } from '@shared/preferences'
import { currentWorkstationHistoryOwner } from '@/features/assets/historyOwner'
import { rememberTool, seedRecentTool } from '@/features/dashboard/recentWork'

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
  const currentUserId=useUserStore(state=>state.userId)
  const credits = useUserStore((s) => s.credits)
  useEffect(()=>{
    const open=()=>setCreditsOpen(true)
    window.addEventListener(RECHARGE_EVENT,open)
    return()=>window.removeEventListener(RECHARGE_EVENT,open)
  },[])
  useEffect(()=>{
    const id=new URLSearchParams(location.search).get('creditOrder'),owner=account?.userId
    if(!id || !owner) return
    queueMicrotask(()=>{if(useUserStore.getState().userId===owner) setCreditsOpen(true)})
    let active=true,attempt=0,timer:ReturnType<typeof setTimeout>
    const check=async()=>{
      try {
        const order=await getCreditOrder(id,owner)
        if(!active || useUserStore.getState().userId!==owner) return
        if(order.status === 'paid') {await refreshBillingBalance(owner);message.success('充值积分已到账');return}
        if(order.status !== 'pending') return
      } catch { if(active && attempt===0) message.info('支付确认可能稍有延迟，可在积分明细中查询到账') }
      if(active && ++attempt<12) timer=setTimeout(()=>void check(),5000)
    }
    void check()
    return()=>{active=false;clearTimeout(timer)}
  },[location.search,account?.userId,message])
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
    try {
      const ownerId = currentWorkstationHistoryOwner()
      seedRecentTool(ownerId, usePreferencesStore.getState().preferences.recent.page)
      rememberTool(ownerId, location.pathname + location.search)
    } catch { /* 账号尚未就绪时不记录导航。 */ }
    if (isPreferencePage(location.pathname)) usePreferencesStore.getState().update({ recent: { page: location.pathname } })
  }, [location.pathname, location.search])

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
    <Layout className="app-shell" style={{ height: '100vh' }}>
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
      <Layout className="app-shell-main">
        <Header className="app-header">
          <div className="app-header-leading">
            {isCanvasRoute(location.pathname)
              ? <CanvasProjectCrumb />
              : <Breadcrumb items={subTitle ? [{ title: topTitle }, { title: subTitle }] : [{ title: topTitle }]} />}
          </div>
          <div className="app-header-trailing">
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
            {isCanvasRoute(location.pathname) ? <CanvasProjectMenu /> : null}
          </div>
        </Header>
        <Content className="app-main-content">
          <PreferencesSyncAlert />
          <ErrorBoundary key={location.pathname}>
            <Outlet context={{ openModelSettings: () => { setSettingsSection('models'); setSettingsOpen(true) } }} />
          </ErrorBoundary>
        </Content>
      </Layout>
      <CreditsLedgerDrawer key={`${currentUserId}:${creditsOpen}`} open={creditsOpen} onClose={() => setCreditsOpen(false)} />
      <CreditSpendGate key={currentUserId} />
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
