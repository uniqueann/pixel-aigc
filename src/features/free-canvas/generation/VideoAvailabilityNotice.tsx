import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import type { CapabilityAvailability } from '@/components/capabilityAvailability'

export default function VideoAvailabilityNotice({ state, onRetry }: { state: CapabilityAvailability; onRetry?: () => void }) {
  const { t } = useTranslation('canvas')
  if (state === 'ready') return null
  if (state === 'soon') return <p role="status">{t('video.availability.soon')}</p>
  if (state === 'error') return <p role="alert">{t('video.availability.error')}{onRetry ? <Button size="small" onClick={onRetry}>{t('video.availability.retry')}</Button> : null}</p>
  return <p role="status">{t('video.availability.loading')}</p>
}
