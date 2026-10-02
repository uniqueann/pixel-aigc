import { useCallback, useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { defaultImageModel, publicImageModel } from '@shared/image-models'
import { loadCapabilityFlags } from '@/services/api/capabilities'
import { listImageModels } from '@/services/api/imageModels'
import { isCanvasMockGateway, useCanvasTextToImageConfiguration, useCanvasVariationConfiguration } from './availability'
import { useUserStore } from '@/store/useUserStore'

function useCanvasImageModels(operation: 'variation' | 'text_to_image') {
  const configurationStore = operation === 'variation' ? useCanvasVariationConfiguration : useCanvasTextToImageConfiguration
  const configuration = useStore(configurationStore)
  const userId = useUserStore(state => state.userId)
  const lifetime = useRef(new AbortController())
  const revision = useRef(0)
  const reload = useCallback(async () => {
    const signal = lifetime.current.signal
    const request = ++revision.current
    const isCurrent = () => !signal.aborted && request === revision.current && useUserStore.getState().userId === userId
    configurationStore.setState({ loading: true, error: undefined, ready: false, models: [] })
    try {
      const mock = isCanvasMockGateway()
      const [flags, models] = mock
        ? [{ variation: true, textToImage: true }, [publicImageModel(defaultImageModel(operation)!)]]
        : await Promise.all([loadCapabilityFlags(), listImageModels(operation)])
      const available = models.filter(model => model.operations.includes(operation))
      const enabled = operation === 'variation' ? flags.variation : flags.textToImage
      if (isCurrent()) configurationStore.setState({ models: available, loading: false, ready: !!enabled && available.length > 0 })
    } catch (error) {
      if (isCurrent()) configurationStore.setState({ loading: false, ready: false, models: [], error: error instanceof Error ? error.message : '模型配置读取失败' })
    }
  }, [configurationStore, operation, userId])
  useEffect(() => {
    const controller = new AbortController()
    lifetime.current = controller
    void reload()
    return () => controller.abort()
  }, [reload])
  return { ...configuration, reload: () => { void reload() } }
}

export function useCanvasVariationModels() {
  return useCanvasImageModels('variation')
}

export function useCanvasTextToImageModels() {
  return useCanvasImageModels('text_to_image')
}
