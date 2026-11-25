import { Button } from 'antd'
import { useTranslation } from 'react-i18next'
import { useUserStore } from '@/store/useUserStore'
import { openCreditRecharge } from '@/services/api/billing'
import { videoCreditEstimateText, videoCreditShortfallText } from './videoCredits'

export default function VideoCreditEstimate({ credits, mockGateway, loading = false }: {
  credits?: number
  mockGateway: boolean
  loading?: boolean
}) {
  const { t } = useTranslation(['canvas', 'credits'])
  const balance = useUserStore(state => state.credits)
  if (loading) return null
  const estimate = videoCreditEstimateText(credits, mockGateway)
  const shortfall = videoCreditShortfallText(credits, balance, mockGateway)
  return (
    <>
      <p className="free-canvas-credit-estimate" role={estimate === t('canvas:video.credits.unavailable') ? 'status' : undefined}>{estimate}</p>
      {shortfall ? <p className="free-canvas-credit-warning" role="status">{shortfall}<Button size="small" type="link" onClick={openCreditRecharge}>{t('credits:quotes.goRecharge')}</Button></p> : null}
    </>
  )
}
