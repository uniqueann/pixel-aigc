import { Button } from 'antd'
import { useTranslation } from 'react-i18next'

interface Props {
  ready: boolean | undefined
  error?: Error | null
  unavailableMessage: string
  onRetry: () => void
}

export default function CapabilityStatus({ ready, error, unavailableMessage, onRetry }: Props) {
  const { t } = useTranslation('common')
  if (ready === true) return null
  if (ready === false) return <p className="toolbox-hint toolbox-warning">{unavailableMessage}</p>
  if (error) return <p className="toolbox-hint" role="alert">
    {t('status.configLoadFailed')}<Button size="small" onClick={onRetry}>{t('actions.retry')}</Button>
  </p>
  return <p className="toolbox-hint" role="status">{t('status.loadingConfig')}</p>
}
