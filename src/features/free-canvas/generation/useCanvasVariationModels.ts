import { useCallback, useEffect, useRef } from 'react'
import { defaultImageModel, publicImageModel } from '@shared/image-models'
import { loadCapabilityFlags } from '@/services/api/capabilities'
import { listImageModels } from '@/services/api/imageModels'
import { isCanvasMockGateway, useCanvasVariationConfiguration } from './availability'
import { useUserStore } from '@/store/useUserStore'

export function useCanvasVariationModels() {
  const configuration = useCanvasVariationConfiguration()
  const userId = useUserStore(state => state.userId)
  const lifetime = useRef(new AbortController())
  const revision = useRef(0)
  const reload = useCallback(async () => {
    const signal = lifetime.current.signal
    const request = ++revision.current
    const isCurrent = () => !signal.aborted && request === revision.current && useUserStore.getState().userId === userId
    useCanvasVariationConfiguration.setState({ loading: true, error: undefined, ready: false })
    try {
      const mock = isCanvasMockGateway()
      const [flags, models] = mock
        ? [{ variation: true }, [publicImageModel(defaultImageModel('variation')!)]]
        : await Promise.all([loadCapabilityFlags(), listImageModels('variation')])
      if (isCurrent()) useCanvasVariationConfiguration.setState({ models, loading: false, ready: !!flags.variation && models.length > 0 })
    } catch (error) {
      if (isCurrent()) useCanvasVariationConfiguration.setState({ loading: false, ready: false, models: [], error: error instanceof Error ? error.message : '模型配置读取失败' })
    }
  }, [userId])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void reload()
    return () => controller.abort()
  }, [reload])
  return { ...configuration, reload: () => { void reload() } }
}
