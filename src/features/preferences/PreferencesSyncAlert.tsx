import { Alert, Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { usePreferencesStore } from './store'

export default function PreferencesSyncAlert({ className = 'preferences-global-error' }: { className?: string }) {
  const { t } = useTranslation('settings')
  const error = usePreferencesStore(state => state.error)
  if (!error) return null
  return (
    <Alert
      className={className}
      type="warning"
      showIcon
      message={error}
      action={<Button size="small" onClick={() => void usePreferencesStore.getState().retry()}>{t('personalization.syncRetry')}</Button>}
    />
  )
}
