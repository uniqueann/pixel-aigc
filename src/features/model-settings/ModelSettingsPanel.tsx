import { useState } from 'react'
import { emailModelIdSchema } from '@shared/email-models'
import { App, Alert, Button, Select, Spin } from 'antd'
import { useTranslation } from 'react-i18next'
import { authEnabled } from '@/cloud/client'
import { saveDefaultEmailModel } from '@/services/api/modelSettings'
import { useModelSettings } from './useModelSettings'

export default function ModelSettingsPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const { message } = App.useApp()
  const { settingsQuery, profilesQuery, updateSettings } = useModelSettings()
  const [busy, setBusy] = useState(false)
  if (!authEnabled) return null
  if (!settingsQuery.data || !profilesQuery.data) {
    return settingsQuery.error || profilesQuery.error ? <Alert type="error" showIcon message={t('settings:personalization.emailModel.loadFailed')}
      action={<Button onClick={() => { void settingsQuery.refetch(); void profilesQuery.refetch() }}>{t('common:actions.retry')}</Button>} /> : <Spin />
  }
  return <section>
    <div className="setting-row"><span><strong>{t('settings:personalization.emailModel.label')}</strong><small>{t('settings:personalization.emailModel.detail')}</small></span>
      <Select aria-label={t('settings:personalization.emailModel.label')} style={{ width: 270 }} disabled={busy} value={settingsQuery.data.defaultEmailModelId ?? 'auto'}
        options={[{ value: 'auto', label: t('settings:personalization.emailModel.auto') }, ...profilesQuery.data.items.map(model => ({
          value: model.id, label: t('settings:personalization.emailModel.creditsUnit', { label: model.label, credits: model.credits }), disabled: !model.available,
        }))]} onChange={async value => {
          setBusy(true)
          try {
            await updateSettings(await saveDefaultEmailModel(value === 'auto' ? null : emailModelIdSchema.parse(value)))
            window.dispatchEvent(new Event('pixel:model-settings-changed'))
            message.success(t('settings:personalization.emailModel.updated'))
          } catch (error) { message.error(error instanceof Error ? error.message : t('settings:account.saveFailed')) }
          finally { setBusy(false) }
        }} />
    </div>
  </section>
}
