import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SEEDANCE_VIDEO_MODEL } from '@shared/video-models'
import { useCapabilities } from '@/hooks/useCapabilities'
import { listVideoModels } from '@/services/api/videoModels'
import { useUserStore } from '@/store/useUserStore'
import { isCanvasMockGateway, useCanvasVideoConfiguration } from './availability'

export function useCanvasVideoModels() {
  const userId = useUserStore(state => state.userId)
  const mock = isCanvasMockGateway()
  const flags = useCapabilities()
  const query = useQuery({ queryKey: ['video-models', userId], queryFn: ({ signal }) => listVideoModels(signal), enabled: !mock, staleTime: 60_000 })
  const models = useMemo(() => mock ? [SEEDANCE_VIDEO_MODEL] : query.data ?? [], [mock, query.data])
  const error = query.error ?? flags.error
  const loading = !mock && !error && (query.isPending || flags.capabilities.textToVideo === undefined)
  const ready = (mock || flags.capabilities.textToVideo === true) && models.length > 0
  const imageReady = (mock || flags.capabilities.imageToVideo === true) && models.length > 0
  useEffect(() => {
    useCanvasVideoConfiguration.setState({ ready, imageReady, models, loading })
    return () => useCanvasVideoConfiguration.setState({ ready: false, imageReady: false, loading: true, models: [] })
  }, [ready, imageReady, loading, models, userId])
  return { ready, imageReady, models, loading, error,
    reload: () => { void query.refetch(); void flags.refetch() } }
}
