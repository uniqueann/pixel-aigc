import { useEffect, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SEEDANCE_VIDEO_MODEL, type VideoModelProfile } from '@shared/video-models'
import { useCapabilities } from '@/hooks/useCapabilities'
import { listVideoModels } from '@/services/api/videoModels'
import { useUserStore } from '@/store/useUserStore'
import { isCanvasMockGateway, useCanvasVideoConfiguration } from './availability'
import { capabilityAvailability, type CapabilityAvailability } from '@/components/capabilityAvailability'

export function videoModelAvailability(capability: boolean | undefined, capabilityError: unknown, models: VideoModelProfile[], pending: boolean, modelError: unknown): CapabilityAvailability {
  const state = capabilityAvailability(capability, capabilityError)
  if (state !== 'ready') return state
  if (pending) return 'loading'
  if (modelError || !models.length) return 'error'
  return 'ready'
}

export function useCanvasVideoModels() {
  const userId = useUserStore(state => state.userId)
  const mock = isCanvasMockGateway()
  const flags = useCapabilities()
  const query = useQuery({ queryKey: ['video-models', userId], queryFn: ({ signal }) => listVideoModels(signal), enabled: !mock && (flags.capabilities.textToVideo === true || flags.capabilities.imageToVideo === true), staleTime: 60_000 })
  const models = useMemo(() => mock ? [SEEDANCE_VIDEO_MODEL] : query.data ?? [], [mock, query.data])
  const textState = mock ? 'ready' : videoModelAvailability(flags.capabilities.textToVideo, flags.error, models, query.isPending, query.error && !query.data)
  const imageState = mock ? 'ready' : videoModelAvailability(flags.capabilities.imageToVideo, flags.error, models, query.isPending, query.error && !query.data)
  const error = flags.error ?? (textState === 'error' || imageState === 'error' ? query.error : null)
  const loading = textState === 'loading' || imageState === 'loading'
  const ready = textState === 'ready'
  const imageReady = imageState === 'ready'
  useEffect(() => {
    useCanvasVideoConfiguration.setState({ ready, imageReady, models, loading, ownerId: userId })
    return () => useCanvasVideoConfiguration.setState({ ready: false, imageReady: false, loading: true, models: [] })
  }, [ready, imageReady, loading, models, userId])
  return { ready, imageReady, models, loading, error, textState, imageState,
    reload: () => { void query.refetch(); void flags.refetch() } }
}
