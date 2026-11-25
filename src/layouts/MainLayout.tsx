import { authEnabled, supabase } from '@/cloud/client'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { useCloudStore } from '@/cloud/sync'
import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { App, Avatar, Breadcrumb, Dropdown, Layout, Menu, Tooltip } from 'antd'
import {
  AppstoreOutlined,
  MailOutlined,
  ShoppingOutlined,
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
import { useTranslation } from 'react-i18next'
import { getNavLabel, getSubRouteLabel } from '@/router/meta'
import { useUserStore } from '@/store/useUserStore'
import { useThemeStore } from '@/store/useThemeStore'
import { TaskCenterProvider } from '@/features/task-center/TaskCenterRuntime'
import { TaskNavigationProvider } from '@/features/task-center/navigation'
import { TaskCenterSidebar,TaskCenterEntry } from '@/features/task-center/TaskCenterSidebar'
import { taskTools,type TaskTool } from '@shared/task-center'
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
import ToolHelpLink from '@/components/ToolHelpLink'
import CreditRulesNotice from '@/features/activation/CreditRulesNotice'
import { syncActivation } from '@/features/activation/client'
import { PixelIcon, PixelWordmark } from '@/components/brand/PixelLogo'

const { Sider, Content, Header } = Layout

function EcommerceNavLabel() {
  const { t } = useTranslation('nav')
  return (
    <span className="nav-item-label">
      <span className="nav-item-label-text">{t('routes.ecommerce')}</span>
      <span className="nav-item-badge">{t('badges.new')}</span>
    </span>
  )
}

const SIDEBAR_FOLD_MIN = 112

function buildNavItems(t: (key: string) => string) {
  return [
    { key: '/', icon: <AppstoreOutlined />, label: t('nav:routes.home') },
    { key: '/email', icon: <MailOutlined />, label: t('nav:routes.email') },
    { key: '/ecommerce', icon: <ShoppingOutlined />, label: <EcommerceNavLabel /> },
    { key: '/image-workstation', icon: <PictureOutlined />, label: t('nav:routes.imageWorkstation') },
    { key: '/toolbox', icon: <ToolOutlined />, label: t('nav:routes.toolbox') },
    { key: '/canvas', icon: <BgColorsOutlined />, label: t('nav:routes.canvas') },
    { key: '/assets', icon: <FolderOutlined />, label: t('nav:routes.assets') },
  ]
}

function accountMenuItems(t: (key: string) => string) {
  return [
    { key: 'personalization', icon: <UserOutlined />, label: t('nav:accountMenu.personalization') },
    { key: 'settings', icon: <SettingOutlined />, label: t('nav:accountMenu.settings') },
    { key: 'help', icon: <QuestionCircleOutlined />, label: t('nav:accountMenu.help') },
    { type: 'divider' as const },
    { key: 'logout', icon: <LogoutOutlined />, label: t('nav:accountMenu.logout') },
  ]
}

function SidebarResizeHandle({ width, onChange }: { width: number; onChange: (width: number, commit: boolean) => void }) {
  const { t } = useTranslation('nav')
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
    aria-label={t('sidebar.resize')}
    aria-valuemin={SIDEBAR_WIDTH_MIN}
    aria-valuemax={SIDEBAR_WIDTH_MAX}
    aria-valuenow={width}
    aria-valuetext={t('sidebar.widthPixels', { width })}
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

export interface SidebarController {
  sidebarOpen: boolean
  toggleSidebar: (open: boolean) => void
  sidebarWidth: number
  canResizeSidebar: boolean
  narrowLocked: boolean
  sidebarResizing: boolean
  changeSidebarWidth: (width: number, commit: boolean) => void
  setSidebarResizing: (resizing: boolean) => void
}

function useSidebarState(): SidebarController {
  // 宽屏下的展开偏好。窄屏自动收起不能改它，也不能把收起写进 localStorage。
  const [preferredOpen, setPreferredOpen] = useState(readPreferredSidebarOpen)
  const [narrowLocked, setNarrowLocked] = useState(() => window.matchMedia('(max-width: 720px)').matches)
  const [narrowManualOpen, setNarrowManualOpen] = useState(false)
  const sidebarOpen = narrowLocked ? narrowManualOpen : preferredOpen
  const [sidebarWidth, setSidebarWidth] = useState(() => readSidebarWidth(usePreferencesStore.getState().owner) ?? SIDEBAR_WIDTH_MAX)
  const [canResizeSidebar, setCanResizeSidebar] = useState(() => window.matchMedia('(min-width: 768px)').matches)
  const [sidebarResizing, setSidebarResizing] = useState(false)
  const sidebarWidthRef = useRef(sidebarWidth)
  const toggleSidebar = useCallback((open: boolean) => {
    if (narrowLocked || window.matchMedia('(max-width: 720px)').matches) {
      setNarrowManualOpen(open)
      return
    }
    setPreferredOpen(open)
    const state = usePreferencesStore.getState()
    if (state.preferences.workbench.rememberSidebar) writeSidebarState(state.owner, open)
  }, [narrowLocked])
  const changeSidebarWidth = (next: number, commit: boolean) => {
    const clamped = clampSidebarWidth(next)
    sidebarWidthRef.current = clamped
    setSidebarWidth(clamped)
    if (commit) writeSidebarWidth(usePreferencesStore.getState().owner, clamped)
  }
  useEffect(() => {
    const onCollapse = () => {
      setNarrowManualOpen(false)
    }
    window.addEventListener('pixel-sidebar-collapse', onCollapse)
    return () => window.removeEventListener('pixel-sidebar-collapse', onCollapse)
  }, [])
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

  return {
    sidebarOpen,
    toggleSidebar,
    sidebarWidth,
    canResizeSidebar,
    narrowLocked,
    sidebarResizing,
    setSidebarResizing,
    changeSidebarWidth,
  }
}

function AppSidebar({
  topKey,
  onAccountMenu,
  sidebar,
}: {
  topKey: string
  onAccountMenu: (key: string) => void
  sidebar: SidebarController
}) {
  const { t } = useTranslation('nav')
  const navigate = useNavigate()
  const account = useUserStore(state => state.account)
  const resolvedTheme = useThemeStore(state => state.resolvedTheme)
  const siderTheme = resolvedTheme === 'dark' ? 'dark' : 'light'
  const isMobile = sidebar.narrowLocked
  const iconOnly = !isMobile && (!sidebar.sidebarOpen || (sidebar.canResizeSidebar && sidebar.sidebarWidth < SIDEBAR_WIDTH_COMPACT))
  const showFold = sidebar.sidebarOpen && (!sidebar.canResizeSidebar || sidebar.sidebarWidth >= SIDEBAR_FOLD_MIN || isMobile)
  const accountName = account?.displayName ?? t('sidebar.personalAccount')

  const { toggleSidebar, sidebarOpen } = sidebar
  useEffect(() => {
    if (!isMobile || !sidebarOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') toggleSidebar(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile, sidebarOpen, toggleSidebar])

  const brandButton = (
    <button
      className="app-brand"
      type="button"
      onClick={() => {
        navigate('/')
        if (isMobile) sidebar.toggleSidebar(false)
      }}
      aria-label={t('sidebar.backToHome')}
    >
      {iconOnly ? <PixelIcon className="app-brand-mark" /> : <PixelWordmark className="app-brand-wordmark" />}
    </button>
  )
  const collapsedWidth = isMobile ? 0 : SIDEBAR_WIDTH_MIN
  return (
    <>
      {isMobile && sidebar.sidebarOpen ? (
        <div
          className="app-sidebar-backdrop"
          onClick={() => sidebar.toggleSidebar(false)}
          aria-hidden="true"
        />
      ) : null}
      <Sider
        theme={siderTheme}
        width={isMobile ? 280 : (sidebar.canResizeSidebar && sidebar.sidebarOpen ? sidebar.sidebarWidth : SIDEBAR_WIDTH_MAX)}
        collapsedWidth={collapsedWidth}
        collapsible
        collapsed={!sidebar.sidebarOpen}
        trigger={null}
        style={sidebar.sidebarResizing ? { transition: 'none' } : undefined}
        className={`app-sidebar${sidebar.sidebarResizing ? ' is-resizing' : ''}${sidebar.sidebarOpen && iconOnly ? ' is-compact' : ''}${isMobile && sidebar.sidebarOpen ? ' is-mobile-open' : ''}`}
      >
        <div className={`app-sidebar-header${sidebar.sidebarOpen ? '' : ' is-collapsed'}`}>
          {sidebar.sidebarOpen ? (
            <>
              {iconOnly ? <Tooltip title={t('sidebar.backToHome')} placement="right">{brandButton}</Tooltip> : brandButton}
              {showFold ? (
                <button className="sidebar-icon-button" type="button" onClick={() => sidebar.toggleSidebar(false)} aria-label={t('sidebar.collapse')}>
                  <MenuFoldOutlined />
                </button>
              ) : null}
            </>
          ) : (
            !isMobile ? (
              <button className="collapsed-brand-toggle" type="button" onClick={() => sidebar.toggleSidebar(true)} aria-label={t('sidebar.expand')}>
                <PixelIcon className="app-brand-mark collapsed-brand-mark" />
                <MenuUnfoldOutlined className="collapsed-brand-icon" />
              </button>
            ) : null
          )}
        </div>
        <Menu
          theme={siderTheme}
          mode="inline"
          inlineCollapsed={iconOnly}
          selectedKeys={[topKey]}
          items={buildNavItems(key => t(key.replace(/^nav:/, '') as never)).filter(item => item.key !== '/ecommerce' || account?.features?.ecommerceSuite)}
          onClick={({ key }) => {
            navigate(key)
            if (isMobile) sidebar.toggleSidebar(false)
          }}
          className="app-sidebar-menu"
        />
        <TaskCenterSidebar compact={iconOnly} />
        <div className="app-sidebar-account">
          <Dropdown
            trigger={['click']}
            placement="topLeft"
            align={sidebar.sidebarOpen && !iconOnly ? undefined : { offset: [sidebar.sidebarOpen ? 12 : 52, 0] }}
            overlayClassName="account-dropdown"
            menu={{
              onClick: ({ key }) => {
                onAccountMenu(key)
                if (isMobile) sidebar.toggleSidebar(false)
              },
              items: accountMenuItems(key => t(key.replace(/^nav:/, '') as never)),
            }}
          >
            <button className="account-trigger" type="button" aria-label={iconOnly ? accountName : undefined} title={iconOnly ? accountName : undefined}>
              <Avatar size={34} src={account?.avatarUrl ?? undefined} icon={account ? undefined : <UserOutlined />}>{account && !account.avatarUrl ? account.displayName.slice(0, 1) : null}</Avatar>
              {iconOnly ? null : (
                <span className="account-trigger-copy">
                  <span className="account-name">{accountName}</span>
                  <span className="account-meta">{account?.email ?? t('sidebar.localMode')}</span>
                </span>
              )}
            </button>
          </Dropdown>
        </div>
        {sidebar.canResizeSidebar && sidebar.sidebarOpen ? (
          <SidebarResizeHandle
            width={sidebar.sidebarWidth}
            onChange={(next, commit) => {
              sidebar.setSidebarResizing(!commit)
              if (!commit) document.body.classList.add('sidebar-resizing')
              else document.body.classList.remove('sidebar-resizing')
              sidebar.changeSidebarWidth(next, commit)
            }}
          />
        ) : null}
      </Sider>
    </>
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
  const { t, i18n } = useTranslation(['nav', 'common'])
  const sidebar = useSidebarState()
  const location = useLocation()
  const navigate = useNavigate()
  const { message } = App.useApp()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const [creditsOpen, setCreditsOpen] = useState(false)
  const [creditsInitialTab, setCreditsInitialTab] = useState<'ledger' | 'recharge'>('ledger')
  const account = useUserStore((s) => s.account)
  const currentUserId=useUserStore(state=>state.userId)
  const credits = useUserStore((s) => s.credits)
  const sidebarOwner = usePreferencesStore(state => state.owner)
  useEffect(() => {
    if (!currentUserId) return
    const sync = () => syncActivation(currentUserId)
    sync()
    window.addEventListener('online', sync)
    return () => window.removeEventListener('online', sync)
  }, [currentUserId])
  useEffect(()=>{
    const open=()=>{
      setCreditsInitialTab('recharge')
      setCreditsOpen(true)
    }
    window.addEventListener(RECHARGE_EVENT,open)
    return()=>window.removeEventListener(RECHARGE_EVENT,open)
  },[])
  useEffect(()=>{
    const id=new URLSearchParams(location.search).get('creditOrder'),owner=account?.userId
    if(!id || !owner) return
    queueMicrotask(()=>{
      if(useUserStore.getState().userId===owner) {
        setCreditsInitialTab('recharge')
        setCreditsOpen(true)
      }
    })
    let active=true,attempt=0,timer:ReturnType<typeof setTimeout>
    const check=async()=>{
      try {
        const order=await getCreditOrder(id,owner)
        if(!active || useUserStore.getState().userId!==owner) return
        if(order.status === 'paid') {await refreshBillingBalance(owner);message.success(t('nav:header.creditOrderPaid'));return}
        if(order.status !== 'pending') return
      } catch { if(active && attempt===0) message.info(t('nav:header.creditOrderPending')) }
      if(active && ++attempt<12) timer=setTimeout(()=>void check(),5000)
    }
    void check()
    return()=>{active=false;clearTimeout(timer)}
  },[location.search,account?.userId,message,t])
  const segments = location.pathname.split('/').filter(Boolean)
  const topKey = getActiveTopKey(location.pathname)
  const topTitle = getNavLabel(topKey)
  const subTitle = segments.length > 1 ? getSubRouteLabel(segments[0], segments[1]) : undefined
  const workbenchTitle = t('common:brand.workbenchTitle')

  useEffect(() => {
    document.title = subTitle ? `${subTitle} · ${topTitle} · ${workbenchTitle}` : `${topTitle} · ${workbenchTitle}`
  }, [topTitle, subTitle, workbenchTitle, i18n.language])

  useEffect(() => {
    try {
      const ownerId = currentWorkstationHistoryOwner()
      seedRecentTool(ownerId, usePreferencesStore.getState().preferences.recent.page)
      rememberTool(ownerId, location.pathname + location.search)
    } catch { /* 账号尚未就绪时不记录导航。 */ }
    if (isPreferencePage(location.pathname)) usePreferencesStore.getState().update({ recent: { page: location.pathname } })
  }, [location.pathname, location.search])

  const { narrowLocked, toggleSidebar } = sidebar
  const currentPath = location.pathname + location.search
  const lastPathRef = useRef(currentPath)
  useEffect(() => {
    if (lastPathRef.current !== currentPath) {
      lastPathRef.current = currentPath
      if (narrowLocked) {
        toggleSidebar(false)
      }
    }
  }, [currentPath, narrowLocked, toggleSidebar])

  const handleAccountMenu = ({ key }: { key: string }) => {
    if (key === 'help') {
      navigate('/help')
      return
    }
    if (key === 'settings' || key === 'personalization') {
      setSettingsSection(key === 'personalization' ? 'personalization' : 'general')
      setSettingsOpen(true)
      void usePreferencesStore.getState().refresh()
      return
    }
    if (key === 'logout' && authEnabled) {
      void (async () => {
        try { await flushProject() } catch { message.warning(t('nav:logoutWarnings.localSaveIncomplete')) }
        if (useCloudStore.getState().busy) message.warning(t('nav:logoutWarnings.cloudSyncIncomplete'))
        useUserStore.getState().setAccount(null)
        const { error } = await supabase!.auth.signOut({ scope: 'local' })
        if (error) throw error
        window.location.replace('/login')
      })().catch(error => message.error(String(error.message)))
      return
    }
    message.info(key === 'logout' ? t('nav:accountMenu.logoutPending') : t('nav:accountMenu.comingSoon'))
  }

  return (
    <TaskNavigationProvider><TaskCenterProvider onCredits={() => setCreditsOpen(true)}>
      <a className="skip-link" href="#app-main-content">{t('nav:sidebar.skipToMain')}</a>
      <Layout className="app-shell" style={{ height: '100vh' }}>
        <AppSidebar
          key={sidebarOwner}
          topKey={topKey}
          onAccountMenu={key => handleAccountMenu({ key })}
          sidebar={sidebar}
        />
        <Layout className="app-shell-main">
          <Header className="app-header">
            <div className="app-header-leading">
              {sidebar.narrowLocked ? (
                <button
                  className="mobile-sidebar-toggle"
                  type="button"
                  onClick={() => sidebar.toggleSidebar(true)}
                  aria-label={t('nav:sidebar.expand')}
                  title={t('nav:sidebar.expand')}
                >
                  <MenuUnfoldOutlined />
                </button>
              ) : null}
              {isCanvasRoute(location.pathname)
                ? <CanvasProjectCrumb />
                : <Breadcrumb items={subTitle ? [{ title: topTitle }, { title: subTitle }] : [{ title: topTitle }]} />}
              <ToolHelpLink />
              {taskToolForPath(location.pathname) ? <TaskCenterEntry tool={taskToolForPath(location.pathname)!} /> : null}
            </div>
            <div className="app-header-trailing">
              <Dropdown
                trigger={['click']}
                placement="bottomRight"
                overlayClassName="account-dropdown"
                menu={{
                  onClick: ({ key }) => handleAccountMenu({ key }),
                  items: accountMenuItems(key => t(key.replace(/^nav:/, '') as never)),
                }}
              >
                <button type="button" className="header-account-trigger" aria-label={t('nav:accountMenu.triggerAria')} title={t('nav:accountMenu.triggerAria')}>
                  <SettingOutlined />
                </button>
              </Dropdown>
              {account && (
                <button
                  type="button"
                  className="credits-trigger"
                  aria-label={t('nav:header.creditsAria', { credits })}
                  onClick={() => {
                    setCreditsInitialTab('ledger')
                    setCreditsOpen(true)
                  }}
                >
                  {t('nav:header.creditsLabel', { credits })}
                </button>
              )}
              {isCanvasRoute(location.pathname) ? <CanvasProjectMenu /> : null}
            </div>
          </Header>
          <Content className="app-main-content" id="app-main-content" tabIndex={-1}>
            {currentUserId ? <CreditRulesNotice key={currentUserId} owner={currentUserId} /> : null}
            <PreferencesSyncAlert />
            <ErrorBoundary key={`${currentUserId}:${account?.runtimeScope}:${location.pathname}`}>
              <Outlet context={{ openModelSettings: () => { setSettingsSection('personalization'); setSettingsOpen(true) } }} />
            </ErrorBoundary>
          </Content>
        </Layout>
        <CreditsLedgerDrawer
          key={`${currentUserId}:${creditsOpen}:${creditsInitialTab}`}
          open={creditsOpen}
          initialTab={creditsInitialTab}
          onClose={() => setCreditsOpen(false)}
        />
        <CreditSpendGate key={currentUserId} />
        <SettingsDialog
          open={settingsOpen}
          section={settingsSection}
          narrow={sidebar.narrowLocked}
          onClose={() => setSettingsOpen(false)}
          onSectionChange={setSettingsSection}
        />
      </Layout>
    </TaskCenterProvider></TaskNavigationProvider>
  )
}

function taskToolForPath(path: string): TaskTool | undefined {
  const parts = path.split('/').filter(Boolean)
  if (parts[0] === 'email') return 'email-assist'
  const candidate = parts[0] === 'image-workstation' ? (parts[1] ?? 'smart-edit')
    : parts[0] === 'toolbox' || parts[0] === 'canvas' ? parts[1] : undefined
  return taskTools.find(tool => tool === candidate)
}
