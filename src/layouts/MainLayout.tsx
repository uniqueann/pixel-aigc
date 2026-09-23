import { authEnabled, cloudRequest, supabase } from '@/cloud/client'
import { flushProject } from '@/editor/persistence/projectPersistence'
import { useCloudStore } from '@/cloud/sync'
import { useEffect, useState } from 'react'
import { App, Avatar, Breadcrumb, Button, Dropdown, Input, Layout, Menu, Modal, Space, Switch } from 'antd'
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
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { NAV_META, SUB_ROUTE_LABELS } from '@/router/meta'
import { useUserStore } from '@/store/useUserStore'
import ErrorBoundary from '@/components/ErrorBoundary'
import ModelSettingsPanel from '@/features/model-settings/ModelSettingsPanel'

const { Sider, Content, Header } = Layout

const SETTINGS_ITEMS = [
  { key: 'general', label: '通用' },
  { key: 'personalization', label: '个性化' },
  { key: 'models', label: '模型与密钥' },
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
  const [sidebarOpen, setSidebarOpen] = useState(() => !window.matchMedia('(max-width: 720px)').matches)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsSection, setSettingsSection] = useState('general')
  const account = useUserStore((s) => s.account)

  const segments = location.pathname.split('/').filter(Boolean)
  const topKey = getActiveTopKey(location.pathname)
  const topTitle = NAV_META[topKey] ?? NAV_META['/']
  const subTitle = segments.length > 1 ? SUB_ROUTE_LABELS[segments[0]]?.[segments[1]] : undefined

  useEffect(() => {
    document.title = subTitle ? `${subTitle} · ${topTitle} · AIGC 工作台` : `${topTitle} · AIGC 工作台`
  }, [topTitle, subTitle])

  useEffect(() => {
    const narrowScreen = window.matchMedia('(max-width: 720px)')
    const collapseOnNarrowScreen = (event: MediaQueryListEvent) => { if (event.matches) setSidebarOpen(false) }
    narrowScreen.addEventListener('change', collapseOnNarrowScreen)
    return () => narrowScreen.removeEventListener('change', collapseOnNarrowScreen)
  }, [])

  const handleAccountMenu = ({ key }: { key: string }) => {
    if (key === 'settings') {
      setSettingsSection('general')
      setSettingsOpen(true)
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
          </Space>
        </Header>
        <Content className="app-main-content">
          <ErrorBoundary>
            <Outlet context={{ openModelSettings: () => { setSettingsSection('models'); setSettingsOpen(true) } }} />
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
            <SettingsContent section={settingsSection} />
          </div>
        </div>
      </Modal>
    </Layout>
  )
}

function SettingsContent({ section }: { section: string }) {
  if (section === 'models') return <ModelSettingsPanel />
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
    return <AccountSettings />
  }
  return (
    <SettingsPanel title="通用" description="调整界面显示和常用体验。">
      <SettingRow label="外观" detail="跟随当前工作台主题"><span>深色</span></SettingRow>
      <SettingRow label="语言" detail="界面显示语言"><span>简体中文</span></SettingRow>
    </SettingsPanel>
  )
}

function AccountSettings() {
  const account = useUserStore((state) => state.account)
  const [displayName, setDisplayName] = useState(account?.displayName ?? '')
  const [workspaceName, setWorkspaceName] = useState(account?.workspace.name ?? '')
  const [busy, setBusy] = useState(false)
  const { message } = App.useApp()
  if (!account) return <SettingsPanel title="账号" description="当前为本地模式，未连接账号。" />
  const save = async (path: string, body: unknown) => {
    setBusy(true)
    try {
      const next = await cloudRequest<import('@/store/useUserStore').AccountContext>(path, 'PATCH', body)
      useUserStore.getState().setAccount(next)
      message.success('已保存')
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败') }
    finally { setBusy(false) }
  }
  return <SettingsPanel title="账号" description="管理 Pixel AIGC 的个人资料与工作空间。">
    <SettingRow label="昵称" detail="仅在 Pixel AIGC 显示">
      <Space.Compact><Input maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} /><Button disabled={busy || !displayName.trim()} onClick={() => void save('/me', { displayName })}>保存</Button></Space.Compact>
    </SettingRow>
    <SettingRow label="个人空间" detail="项目归属的个人空间">
      <Space.Compact><Input maxLength={80} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /><Button disabled={busy || !workspaceName.trim()} onClick={() => void save(`/workspaces/${account.workspace.id}`, { name: workspaceName })}>保存</Button></Space.Compact>
    </SettingRow>
    <SettingRow label="邮箱" detail={account.emailVerified ? '已验证' : '未验证'}><span>{account.email}</span></SettingRow>
    <SettingRow label="登录方式" detail="共享 Supabase 账号"><span>{account.providers.map(p => p === 'google' ? 'Google' : p === 'email' ? '邮箱密码' : p).join('、')}</span></SettingRow>
    <SettingRow label="账号安全" detail="重置密码也会影响此账号在 ContentUp、EDM 中的密码登录">
      {account.providers.includes('email') ? <Button onClick={() => window.location.assign('/forgot-password')}>重置密码</Button> : <span>请在 Google 账号中管理登录安全</span>}
    </SettingRow>
  </SettingsPanel>
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
