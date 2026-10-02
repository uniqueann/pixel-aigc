import { useEffect, useRef, useState } from 'react'
import { App, Button, Input, Menu, Modal, Space, Switch } from 'antd'
import { cloudRequest } from '@/cloud/client'
import ModelSettingsPanel from '@/features/model-settings/ModelSettingsPanel'
import PersonalizationPanel from '@/features/preferences/PersonalizationPanel'
import { usePreferencesStore } from '@/features/preferences/store'
import { useUserStore } from '@/store/useUserStore'

export const SETTINGS_ITEMS = [
  { key: 'general', label: '通用' },
  { key: 'personalization', label: '个性化' },
  { key: 'models', label: '模型与密钥' },
  { key: 'data', label: '数据控制' },
  { key: 'account', label: '账号' },
]

const SETTINGS_MODAL_WIDTH = 'min(760px, calc(100vw - 24px))'

export default function SettingsDialog({
  open,
  section,
  narrow,
  onClose,
  onSectionChange,
}: {
  open: boolean
  section: string
  narrow: boolean
  onClose: () => void
  onSectionChange: (section: string) => void
}) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const selected = menuRef.current?.querySelector<HTMLElement>('.ant-menu-item-selected')
    selected?.scrollIntoView({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [open, section, narrow])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={SETTINGS_MODAL_WIDTH}
      title="设置"
      centered
      className="settings-modal"
      wrapClassName="settings-modal-wrap"
      destroyOnClose={false}
    >
      <div className={`settings-layout${narrow ? ' is-narrow' : ''}`}>
        <div ref={menuRef} className={`settings-menu-shell${narrow ? ' is-narrow' : ''}`}>
          <Menu
            mode="inline"
            selectedKeys={[section]}
            items={SETTINGS_ITEMS}
            onClick={({ key }) => {
              onSectionChange(key)
              if (key === 'personalization') void usePreferencesStore.getState().refresh()
            }}
            className={`settings-menu${narrow ? ' is-narrow' : ''}`}
          />
        </div>
        <div className="settings-content">
          <SettingsContent section={section} />
        </div>
      </div>
    </Modal>
  )
}

function SettingsContent({ section }: { section: string }) {
  if (section === 'models') return <ModelSettingsPanel />
  if (section === 'personalization') return <PersonalizationPanel />
  if (section === 'data') {
    return (
      <SettingsPanel title="数据控制" description="管理项目数据与产品改进选项。">
        <SettingRow label="帮助改进 Pixel AIGC" detail="允许使用匿名使用数据改进产品体验">
          <Switch defaultChecked />
        </SettingRow>
      </SettingsPanel>
    )
  }
  if (section === 'account') return <AccountSettings />
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
  return (
    <SettingsPanel title="账号" description="管理 Pixel AIGC 的个人资料与工作空间。">
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
