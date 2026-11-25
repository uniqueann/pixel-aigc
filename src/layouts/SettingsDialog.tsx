import { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Input, Menu, Modal, Segmented, Select, Space, Switch } from 'antd'
import { DesktopOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons'
import { useTranslation } from 'react-i18next'
import { cloudRequest } from '@/cloud/client'
import ModelSettingsPanel from '@/features/model-settings/ModelSettingsPanel'
import PersonalizationPanel from '@/features/preferences/PersonalizationPanel'
import PreferencesSyncAlert from '@/features/preferences/PreferencesSyncAlert'
import { usePreferencesStore } from '@/features/preferences/store'
import { useLocaleStore } from '@/i18n/store'
import type { Locale } from '@/i18n/types'
import { useUserStore } from '@/store/useUserStore'
import { useThemeStore, type ThemeMode } from '@/store/useThemeStore'
import { saveWelcomeState } from '@/features/activation/client'

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
  const { t } = useTranslation('settings')
  const menuRef = useRef<HTMLDivElement>(null)

  const settingsItems = useMemo(() => [
    { key: 'general', label: t('tabs.general') },
    { key: 'personalization', label: t('tabs.personalization') },
    { key: 'data', label: t('tabs.data') },
    { key: 'account', label: t('tabs.account') },
  ], [t])

  useEffect(() => {
    if (!open) return
    const selected = menuRef.current?.querySelector<HTMLElement>('.ant-menu-item-selected')
    selected?.scrollIntoView?.({ inline: 'nearest', block: 'nearest', behavior: 'smooth' })
  }, [open, section, narrow])

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={SETTINGS_MODAL_WIDTH}
      title={t('title')}
      centered
      className="settings-modal"
      wrapClassName="settings-modal-wrap"
      style={{ maxWidth: 'calc(100vw - 24px)' }}
      styles={{ wrapper: { overflowX: 'hidden' }, content: { maxWidth: '100%' }, body: { overflowX: 'hidden' } }}
    >
      <PreferencesSyncAlert />
      <div className={`settings-layout${narrow ? ' is-narrow' : ''}`} style={{ maxWidth: '100%', minWidth: 0 }}>
        <div ref={menuRef} className={`settings-menu-shell${narrow ? ' is-narrow' : ''}`} style={narrow ? { maxWidth: '100%', minWidth: 0, overflowX: 'auto', scrollbarWidth: 'none' } : undefined}>
          <Menu
            mode="inline"
            selectedKeys={[section]}
            items={settingsItems}
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
  const { t } = useTranslation('settings')
  if (section === 'models' || section === 'personalization') return <><PersonalizationPanel /><ModelSettingsPanel /></>
  if (section === 'data') {
    return (
      <SettingsPanel title={t('data.title')} description={t('data.description')}>
        <UsageDataSetting />
      </SettingsPanel>
    )
  }
  if (section === 'account') return <AccountSettings />
  return (
    <SettingsPanel title={t('general.title')} description={t('general.description')}>
      <AppearanceSetting />
      <LanguageSetting />
    </SettingsPanel>
  )
}

function LanguageSetting() {
  const { t } = useTranslation('settings')
  const locale = useLocaleStore(state => state.locale)
  const setLocale = useLocaleStore(state => state.setLocale)
  const [switching, setSwitching] = useState(false)

  return (
    <SettingRow label={t('general.languageLabel')} detail={t('general.languageDetail')}>
      <Select<Locale>
        aria-label={t('general.languageSelectAria')}
        value={locale}
        loading={switching}
        disabled={switching}
        style={{ minWidth: 132 }}
        onChange={async val => {
          setSwitching(true)
          try { await setLocale(val) } finally { setSwitching(false) }
        }}
        options={[
          { value: 'zh-CN', label: '简体中文' },
          { value: 'en-US', label: 'English' },
        ]}
      />
    </SettingRow>
  )
}

function AppearanceSetting() {
  const { t } = useTranslation('settings')
  const mode = useThemeStore(state => state.mode)
  const resolvedTheme = useThemeStore(state => state.resolvedTheme)
  const setMode = useThemeStore(state => state.setMode)

  const resolvedLabel = resolvedTheme === 'dark' ? t('general.modes.dark') : t('general.modes.light')
  const detailText = mode === 'system'
    ? t('general.appearanceSystemDetail', { mode: resolvedLabel })
    : mode === 'dark'
      ? t('general.appearanceDarkDetail')
      : t('general.appearanceLightDetail')

  return (
    <SettingRow label={t('general.appearanceLabel')} detail={detailText}>
      <Segmented<ThemeMode>
        aria-label={t('general.appearanceAria')}
        value={mode}
        onChange={val => setMode(val)}
        options={[
          {
            value: 'light',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <SunOutlined />
                <span>{t('general.modes.light')}</span>
              </span>
            ),
          },
          {
            value: 'dark',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <MoonOutlined />
                <span>{t('general.modes.dark')}</span>
              </span>
            ),
          },
          {
            value: 'system',
            label: (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <DesktopOutlined />
                <span>{t('general.modes.system')}</span>
              </span>
            ),
          },
        ]}
      />
    </SettingRow>
  )
}

function UsageDataSetting() {
  const { t } = useTranslation('settings')
  const account = useUserStore(state => state.account)
  const [saving, setSaving] = useState(false)
  const { message } = App.useApp()
  return <SettingRow label={t('data.analyticsLabel')} detail={t('data.analyticsDetail')}>
    <Switch aria-label={t('data.analyticsAria')} checked={account?.welcome?.analyticsEnabled ?? true}
      disabled={!account?.welcome || saving} loading={saving} onChange={async enabled => {
        if (!account) return
        setSaving(true)
        try { await saveWelcomeState(account.userId, { analyticsEnabled: enabled }) }
        catch { message.error(t('data.analyticsSaveFailed')) }
        finally { setSaving(false) }
      }} />
  </SettingRow>
}

function AccountSettings() {
  const { t } = useTranslation(['settings', 'common'])
  const account = useUserStore((state) => state.account)
  const [displayName, setDisplayName] = useState(account?.displayName ?? '')
  const [workspaceName, setWorkspaceName] = useState(account?.workspace.name ?? '')
  const [busy, setBusy] = useState(false)
  const { message } = App.useApp()
  if (!account) return <SettingsPanel title={t('settings:account.title')} description={t('settings:account.localDescription')} />
  const save = async (path: string, body: unknown) => {
    setBusy(true)
    try {
      const next = await cloudRequest<import('@/store/useUserStore').AccountContext>(path, 'PATCH', body)
      useUserStore.getState().setAccount(next)
      message.success(t('common:actions.saved'))
    } catch (error) { message.error(error instanceof Error ? error.message : t('settings:account.saveFailed')) }
    finally { setBusy(false) }
  }
  return (
    <SettingsPanel title={t('settings:account.title')} description={t('settings:account.description')}>
      <SettingRow label={t('settings:account.displayNameLabel')} detail={t('settings:account.displayNameDetail')}>
        <Space.Compact><Input maxLength={80} value={displayName} onChange={event => setDisplayName(event.target.value)} /><Button disabled={busy || !displayName.trim()} onClick={() => void save('/me', { displayName })}>{t('common:actions.save')}</Button></Space.Compact>
      </SettingRow>
      <SettingRow label={t('settings:account.workspaceLabel')} detail={t('settings:account.workspaceDetail')}>
        <Space.Compact><Input maxLength={80} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} /><Button disabled={busy || !workspaceName.trim()} onClick={() => void save(`/workspaces/${account.workspace.id}`, { name: workspaceName })}>{t('common:actions.save')}</Button></Space.Compact>
      </SettingRow>
      <SettingRow label={t('settings:account.emailLabel')} detail={account.emailVerified ? t('settings:account.emailVerified') : t('settings:account.emailUnverified')}><span>{account.email}</span></SettingRow>
      <SettingRow label={t('settings:account.providersLabel')} detail={t('settings:account.providersDetail')}><span>{account.providers.map(p => p === 'google' ? t('settings:account.providerNames.google') : p === 'email' ? t('settings:account.providerNames.email') : p).join(t('settings:account.providerSeparator'))}</span></SettingRow>
      <SettingRow label={t('settings:account.securityLabel')} detail={t('settings:account.securityDetail')}>
        {account.providers.includes('email') ? <Button onClick={() => window.location.assign('/forgot-password')}>{t('settings:account.resetPassword')}</Button> : <span>{t('settings:account.googleSecurityHint')}</span>}
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
