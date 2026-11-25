import { EMAIL_LANGUAGE_OPTIONS } from '@shared/email-models'
import { useMemo, useState } from 'react'
import { App, Button, Popconfirm, Select, Space, Switch } from 'antd'
import { useTranslation } from 'react-i18next'
import { defaultImageModel } from '@shared/image-models'
import { COUNT_TOOLS } from '@shared/preferences'
import { usePreferencesStore } from './store'
import { clearSidebarState } from './storage'
import { CLEAR_IMAGE_MEMORY_SUCCESS_DURATION, clearImageMemoryFailureMessage } from './errors'
import PreferencesSyncAlert from './PreferencesSyncAlert'

const START_PAGE_KEYS = [
  { value: '/', key: 'personalization.startPages.home' },
  { value: '/email', key: 'personalization.startPages.email' },
  { value: '/image-workstation', key: 'personalization.startPages.imageWorkstation' },
  { value: '/toolbox', key: 'personalization.startPages.toolbox' },
  { value: '/canvas', key: 'personalization.startPages.canvas' },
  { value: '/assets', key: 'personalization.startPages.assets' },
  { value: 'last', key: 'personalization.startPages.last' },
] as const

function PreferenceRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return <div className="setting-row"><span><strong>{label}</strong><small>{detail}</small></span><div className="preference-control">{children}</div></div>
}

export default function PersonalizationPanel() {
  const { t } = useTranslation(['settings', 'email', 'common'])
  const preferences = usePreferencesStore(state => state.preferences)
  const status = usePreferencesStore(state => state.status)
  const update = usePreferencesStore(state => state.update)
  const { message } = App.useApp()
  const [clearing, setClearing] = useState(false)
  const [clearError, setClearError] = useState<string | null>(null)
  const { workbench, image, email } = preferences
  const hasMemory = Object.keys(image.lastUsed).length > 0
  const statusText = status === 'saving'
    ? t('settings:personalization.syncStatus.saving')
    : status === 'saved'
      ? t('settings:personalization.syncStatus.saved')
      : status === 'local'
        ? t('settings:personalization.syncStatus.local')
        : status === 'loading'
          ? t('settings:personalization.syncStatus.loading')
          : t('settings:personalization.syncStatus.idle')
  const canClear = hasMemory || status === 'error' || Boolean(clearError)

  const startPages = useMemo(
    () => START_PAGE_KEYS.map(item => ({ value: item.value, label: t(`settings:${item.key}` as never) })),
    [t],
  )
  const emailLanguages = useMemo(
    () => EMAIL_LANGUAGE_OPTIONS.map(item => ({ value: item.value, label: t(`email:languages.${item.value}` as never) })),
    [t],
  )

  async function clearImageMemory() {
    setClearing(true)
    try {
      await usePreferencesStore.getState().clearImageMemory()
      setClearError(null)
      message.success({ content: t('settings:personalization.clearMemorySuccess'), duration: CLEAR_IMAGE_MEMORY_SUCCESS_DURATION })
    } catch (caught) {
      const text = clearImageMemoryFailureMessage(caught)
      setClearError(text)
      message.error(text)
    } finally {
      setClearing(false)
    }
  }
  return <section className="personalization-panel">
    <h2>{t('settings:personalization.title')}</h2>
    <p className="settings-description">{t('settings:personalization.description')}</p>
    <div className="preferences-sync-status" role="status" aria-live="polite">{statusText}</div>
    <PreferencesSyncAlert className="preferences-panel-error" />

    <h3 className="preferences-group-title">{t('settings:personalization.workbenchGroup')}</h3>
    <div className="settings-rows">
      <PreferenceRow label={t('settings:personalization.startPageLabel')} detail={t('settings:personalization.startPageDetail')}>
        <Select aria-label={t('settings:personalization.startPageLabel')} value={workbench.startPage} options={startPages} onChange={startPage => update({ workbench: { startPage } })} />
      </PreferenceRow>
      <PreferenceRow label={t('settings:personalization.rememberSidebarLabel')} detail={t('settings:personalization.rememberSidebarDetail')}>
        <Switch aria-label={t('settings:personalization.rememberSidebarLabel')} checked={workbench.rememberSidebar} onChange={rememberSidebar => update({ workbench: { rememberSidebar } })} />
      </PreferenceRow>
      <PreferenceRow label={t('settings:personalization.assetsViewLabel')} detail={t('settings:personalization.assetsViewDetail')}>
        <Select aria-label={t('settings:personalization.assetsViewLabel')} value={workbench.assetsView} options={[
          { value: 'grid', label: t('settings:personalization.assetsViews.grid') },
          { value: 'list', label: t('settings:personalization.assetsViews.list') },
          { value: 'remember', label: t('settings:personalization.assetsViews.remember') },
        ]} onChange={assetsView => update({ workbench: { assetsView } })} />
      </PreferenceRow>
    </div>

    <h3 className="preferences-group-title">{t('settings:personalization.imageGroup')}</h3>
    <div className="settings-rows">
      <PreferenceRow label={t('settings:personalization.defaultCountLabel')} detail={t('settings:personalization.defaultCountDetail')}>
        <div className="preferences-counts">
          {COUNT_TOOLS.map(tool => {
            const max = defaultImageModel(tool === 'variation' ? 'variation' : 'image_edit')?.ui.maxCount ?? 4
            const toolLabel = t(`settings:personalization.countTools.${tool}` as never)
            return <label key={tool}><span>{toolLabel}</span><Select aria-label={t('settings:personalization.defaultCountAria', { tool: toolLabel })} value={image.counts[tool]} options={Array.from({ length: max }, (_, i) => ({ value: i + 1, label: t('settings:personalization.countOption', { count: i + 1 }) }))} onChange={value => update({ image: { counts: { [tool]: value } } })} /></label>
          })}
        </div>
      </PreferenceRow>
      <PreferenceRow label={t('settings:personalization.defaultResolutionLabel')} detail={t('settings:personalization.defaultResolutionDetail')}>
        <Select aria-label={t('settings:personalization.defaultResolutionLabel')} value={image.resolution} options={(defaultImageModel('image_edit')?.ui.resolutions ?? ['2k']).map(value => ({ value, label: value.toUpperCase() }))} onChange={resolution => update({ image: { resolution } })} />
      </PreferenceRow>
      <PreferenceRow label={t('settings:personalization.rememberParametersLabel')} detail={t('settings:personalization.rememberParametersDetail')}>
        <Switch aria-label={t('settings:personalization.rememberParametersLabel')} checked={image.rememberParameters} onChange={rememberParameters => update({ image: { rememberParameters } })} />
      </PreferenceRow>
    </div>
    <div className="preferences-memory-actions">
      <p>{t('settings:personalization.memoryPrivacyHint')}</p>
      <div className="preferences-clear-actions">
        <Popconfirm title={t('settings:personalization.clearMemoryTitle')} description={t('settings:personalization.clearMemoryDescription')} okText={t('settings:personalization.clearMemoryConfirm')} cancelText={t('common:actions.cancel')} getPopupContainer={() => document.body} onConfirm={() => clearImageMemory()}>
          <Button size="small" loading={clearing} disabled={!canClear || clearing}>{t('settings:personalization.clearMemoryButton')}</Button>
        </Popconfirm>
        {clearError ? (
          <>
            <button type="button" className="preferences-clear-retry" disabled={clearing} onClick={() => void clearImageMemory()}>{t('common:actions.retry')}</button>
            <span className="preferences-clear-error" role="alert">{clearError}</span>
          </>
        ) : null}
      </div>
    </div>

    <h3 className="preferences-group-title">{t('settings:personalization.emailGroup')}</h3>
    <div className="settings-rows">
      <PreferenceRow label={t('settings:personalization.emailLanguageLabel')} detail={t('settings:personalization.emailLanguageDetail')}>
        <Select aria-label={t('settings:personalization.emailLanguageLabel')} value={email.language} options={emailLanguages} onChange={language => update({ email: { language } })} />
      </PreferenceRow>
      <PreferenceRow label={t('settings:personalization.emailOperationLabel')} detail={t('settings:personalization.emailOperationDetail')}>
        <Select aria-label={t('settings:personalization.emailOperationLabel')} value={email.operation} options={[
          { value: 'reply', label: t('settings:personalization.emailOperations.reply') },
          { value: 'summarize', label: t('settings:personalization.emailOperations.summarize') },
          { value: 'polish', label: t('settings:personalization.emailOperations.polish') },
          { value: 'grammar', label: t('settings:personalization.emailOperations.grammar') },
        ]} onChange={operation => update({ email: { operation } })} />
      </PreferenceRow>
      <PreferenceRow label={t('settings:personalization.emailPolishStylesLabel')} detail={t('settings:personalization.emailPolishStylesDetail')}>
        <Select aria-label={t('settings:personalization.emailPolishStylesLabel')} mode="multiple" value={email.polishStyles} options={[
          { value: 'clear', label: t('settings:personalization.emailPolishStyles.clear') },
          { value: 'shorten', label: t('settings:personalization.emailPolishStyles.shorten') },
          { value: 'lengthen', label: t('settings:personalization.emailPolishStyles.lengthen') },
          { value: 'simplify', label: t('settings:personalization.emailPolishStyles.simplify') },
        ]} onChange={polishStyles => update({ email: { polishStyles } })} />
      </PreferenceRow>
    </div>
    <div className="preferences-footer">
      <span>{t('settings:personalization.footerAutoSave')}</span>
      <Space><Popconfirm title={t('settings:personalization.resetAllTitle')} description={t('settings:personalization.resetAllDescription')} okText={t('settings:personalization.resetAllConfirm')} cancelText={t('common:actions.cancel')} onConfirm={() => {
        clearSidebarState(usePreferencesStore.getState().owner)
        usePreferencesStore.getState().reset()
      }}><Button>{t('settings:personalization.resetAllButton')}</Button></Popconfirm></Space>
    </div>
  </section>
}
