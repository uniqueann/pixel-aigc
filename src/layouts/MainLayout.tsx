import { authEnabled, supabase } from '@/cloud/client'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { useCloudStore } from '@/cloud/sync'
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { App, Avatar, Breadcrumb, Dropdown, Layout, Menu, Tooltip } from 'antd'
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
import { clampSidebarWidth, readSidebarState, readSidebarWidth, SIDEBAR_WIDTH_COMPACT, SIDEBAR_WIDTH_MAX, SIDEBAR_WIDTH_MIN, writeSidebarState, writeSidebarWidth } from '@/features/preferences/storage'
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

const SIDEBAR_FOLD_MIN = 112

function accountMenuItems() {
  return [
    { key: 'personalization', icon: <UserOutlined />, label: '个性化' },
    { key: 'settings', icon: <SettingOutlined />, label: '设置' },
    { key: 'help', icon: <QuestionCircleOutlined />, label: '帮助与支持' },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
  ]
}

function SidebarResizeHandle({ width, onChange }: { width: number; onChange: (width: number, commit: boolean) => void }) {
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    const handle = event.currentTarget
    const sider = handle.closest('.app-sidebar')
    if (sider instanceof HTMLElement) sider.style.setProperty('transition', 'none')
    try { handle.setPointerCapture(event.pointerId) } catch { /* 测试环境可能没有指针捕获。 */ }
    const startX = event.clientX
    const startWidth = width
    document.body.classList.add('sidebar-resizing')
    let frame = 0
    let latest = startWidth
    const move = (ev: PointerEvent) => {
      latest = clampSidebarWidth(startWidth + ev.clientX - startX)
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => onChange(latest, false))
    }
    const end = (ev: PointerEvent) => {
      cancelAnimationFrame(frame)
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      try { handle.releasePointerCapture(ev.pointerId) } catch { /* 已经释放。 */ }
      if (sider instanceof HTMLElement) sider.style.removeProperty('transition')
      document.body.classList.remove('sidebar-resizing')
      onChange(latest, true)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const delta = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
    if (!delta) return
    event.preventDefault()
    onChange(clampSidebarWidth(width + delta), true)
  }
  return <div
    className="sidebar-resize-handle"
    role="separator"
    aria-orientation="vertical"
    aria-label="调整侧边栏宽度"
    aria-valuemin={SIDEBAR_WIDTH_MIN}
    aria-valuemax={SIDEBAR_WIDTH_MAX}
    aria-valuenow={width}
    aria-valuetext={`${width} 像素`}
    tabIndex={0}
    onPointerDown={onPointerDown}
    onDoubleClick={() => onChange(SIDEBAR_WIDTH_MAX, true)}
    onKeyDown={onKeyDown}
  />
}

/** 嵌套路径（如 /image-workstation/remove）也要能高亮到对应的顶层菜单项 */
function getActiveTopKey(pathname: string) {
  const first = pathname.split('/').filter(Boolean)[0]
  return first ? `/${first}` : '/'
}

function readPreferredSidebarOpen() {
  const state = usePreferencesStore.getState()
  return state.preferences.workbench.rememberSidebar ? readSidebarState(state.owner) ?? true : true
}

function AppSidebar({ topKey, onAccountMenu }: { topKey: string; onAccountMenu: (key: string) => void }) {
  const navigate = useNavigate()
  const account = useUserStore(state => state.account)
  // 宽屏下的展开偏好。窄屏自动收起不能改它，也不能把收起写进 localStorage。
  const [preferredOpen, setPreferredOpen] = useState(readPreferredSidebarOpen)
  const [narrowLocked, setNarrowLocked] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const [narrowManualOpen, setNarrowManualOpen] = useState(false)
  const sidebarOpen = narrowLocked ? narrowManualOpen : preferredOpen
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(usePreferencesStore.getState().owner) ?? SIDEBAR_WIDTH_MAX)
  const [canResizeSidebar, setCanResizeSidebar] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  const toggleSidebar = (open: boolean) => {
    if (narrowLocked || window.matchMedia('(max-width: 720px)').matches) {
      setNarrowManualOpen(open)
      return
    }
    setPreferredOpen(open)
    const state = usePreferencesStore.getState()
    if (state.preferences.workbench.rememberSidebar) writeSidebarState(state.owner, open)
  }
  const changeSidebarWidth = (next: number, commit: boolean) => {
    const clamped = clampSidebarWidth(next)
    sidebarWidthRef.current = clamped
    setSidebarWidth(clamped)
    if (commit) writeSidebarWidth(usePreferencesStore.getState().owner, clamped)
  }
  useEffect(() => {
    const onReset = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== usePreferencesStore.getState().owner) return
      sidebarWidthRef.current = SIDEBAR_WIDTH_MAX
      setSidebarWidth(SIDEBAR_WIDTH_MAX)
    }
    window.addEventListener('pixel-sidebar-reset', onReset)
    return () => window.removeEventListener('pixel-sidebar-reset', onReset)
  }, [])
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 768px)')
    const narrow = window.matchMedia('(max-width: 720px)')
    const onDesktop = (event: MediaQueryListEvent) => {
      setCanResizeSidebar(event.matches)
      if (!event.matches) return
      setNarrowLocked(false)
      setNarrowManualOpen(false)
      const saved = readSidebarWidth(usePreferencesStore.getState().owner) ?? SIDEBAR_WIDTH_MAX
      sidebarWidthRef.current = saved
      setSidebarWidth(saved)
    }
    const onNarrow = (event: MediaQueryListEvent) => {
      if (!event.matches) return
      setNarrowLocked(true)
      setNarrowManualOpen(false)
    }
    desktop.addEventListener('change', onDesktop)
    narrow.addEventListener('change', onNarrow)
    return () => {
      desktop.removeEventListener('change', onDesktop)
      narrow.removeEventListener('change', onNarrow)
    }
  }, [])
  useEffect(() => () => { document.body.classList.remove('sidebar-resizing') }, [])
  const iconOnly = !sidebarOpen || (canResizeSidebar && sidebarWidth < SIDEBAR_WIDTH_COMPACT)
  const showFold = sidebarOpen && (!canResizeSidebar || sidebarWidth >= SIDEBAR_FOLD_MIN)
  const accountName = account?.displayName ?? '个人账号'
  const brandButton = (
    <button className="app-brand" type="button" onClick={() => navigate('/')} aria-label="返回工作台首页">
      <span className="app-brand-mark">P</span>
      {iconOnly ? null : <span className="app-brand-name">Pixel AIGC</span>}
    </button>
  )
  return (
    <Sider
      width={canResizeSidebar && sidebarOpen ? sidebarWidth : SIDEBAR_WIDTH_MAX}
      collapsedWidth={SIDEBAR_WIDTH_MIN}
      collapsible
      collapsed={!sidebarOpen}
      trigger={null}
      style={sidebarResizing ? { transition: 'none' } : undefined}
      className={`app-sidebar${sidebarResizing ? ' is-resizing' : ''}${sidebarOpen && iconOnly ? ' is-compact' : ''}`}
    >
      <div className={`app-sidebar-header${sidebarOpen ? '' : ' is-collapsed'}`}>
        {sidebarOpen ? (
          <>
            {iconOnly ? <Tooltip title="返回工作台首页" placement="right">{brandButton}</Tooltip> : brandButton}
            {showFold ? (
              <button className="sidebar-icon-button" type="button" onClick={() => toggleSidebar(false)} aria-label="收起侧边栏">
                <MenuFoldOutlined />
              </button>
            ) : null}
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
        inlineCollapsed={iconOnly}
        selectedKeys={[topKey]}
        items={NAV_ITEMS}
        onClick={({ key }) => navigate(key)}
        className="app-sidebar-menu"
      />
      <div className="app-sidebar-account">
        <Dropdown
          trigger={['click']}
          placement="topLeft"
          align={sidebarOpen && !iconOnly ? undefined : { offset: [sidebarOpen ? 12 : 52, 0] }}
          overlayClassName="account-dropdown"
          menu={{
            onClick: ({ key }) => onAccountMenu(key),
            items: accountMenuItems(),
          }}
        >
          <button className="account-trigger" type="button" aria-label={iconOnly ? accountName : undefined} title={iconOnly ? accountName : undefined}>
            <Avatar size={34} src={account?.avatarUrl ?? undefined} icon={account ? undefined : <UserOutlined />}>{account && !account.avatarUrl ? account.displayName.slice(0, 1) : null}</Avatar>
            {iconOnly ? null : (
              <span className="account-trigger-copy">
                <span className="account-name">{accountName}</span>
                <span className="account-meta">{account?.email ?? '本地模式'}</span>
              </span>
            )}
          </button>
        </Dropdown>
      </div>
      {canResizeSidebar && sidebarOpen ? (
        <SidebarResizeHandle
          width={sidebarWidth}
          onChange={(next, commit) => {
            setSidebarResizing(!commit)
            if (!commit) document.body.classList.add('sidebar-resizing')
            else document.body.classList.remove('sidebar-resizing')
            changeSidebarWidth(next, commit)
          }}
        />
      ) : null}
    </Sider>
  )
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
  const { message } = App.useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [narrowScreen, setNarrowScreen] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const account = useUserStore((s) => s.account)
  const currentUserId=useUserStore(state=>state.userId)
  const credits = useUserStore((s) => s.credits)
  const sidebarOwner = usePreferencesStore(state => state.owner)
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
    const onChange = (event: MediaQueryListEvent) => setNarrowScreen(event.matches)
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
      <AppSidebar key={sidebarOwner} topKey={topKey} onAccountMenu={key => handleAccountMenu({ key })} />
      <Layout className="app-shell-main">
        <Header className="app-header">
          <div className="app-header-leading">
            {isCanvasRoute(location.pathname)
              ? <CanvasProjectCrumb />
              : <Breadcrumb items={subTitle ? [{ title: topTitle }, { title: subTitle }] : [{ title: topTitle }]} />}
          </div>
          <div className="app-header-trailing">
            <Dropdown
              trigger={['click']}
              placement="bottomRight"
              overlayClassName="account-dropdown"
              menu={{
                onClick: ({ key }) => handleAccountMenu({ key }),
                items: accountMenuItems(),
              }}
            >
              <button type="button" className="header-account-trigger" aria-label="账号与设置" title="账号与设置">
                <SettingOutlined />
              </button>
            </Dropdown>
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
