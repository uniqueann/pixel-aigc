import { useUserStore } from '@/store/useUserStore'
import { videoCreditEstimateText, videoCreditShortfallText } from './videoCredits'

export default function VideoCreditEstimate({ credits, mockGateway, loading = false }: {
  credits?: number
  mockGateway: boolean
  loading?: boolean
}) {
  const balance = useUserStore(state => state.credits)
  if (loading) return null
  const estimate = videoCreditEstimateText(credits, mockGateway)
  const shortfall = videoCreditShortfallText(credits, balance, mockGateway)
  return (
    <>
      <p className="free-canvas-credit-estimate" role={estimate === '积分预估暂不可用' ? 'status' : undefined}>{estimate}</p>
      {shortfall ? <p className="free-canvas-credit-warning" role="status">{shortfall}</p> : null}
    </>
  )
}
