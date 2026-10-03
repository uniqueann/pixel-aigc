import { create } from 'zustand'
import { authEnabled, cloudEnabled } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import type { PublicImageModel } from '@/services/api/imageModels'
import type { VideoModelProfile } from '@shared/video-models'

interface CanvasImageConfiguration {
  ready: boolean; loading: boolean; models: PublicImageModel[]; error?: string
}

export const useCanvasVariationConfiguration = create<CanvasImageConfiguration>(() => ({ ready: false, loading: true, models: [] }))
export const useCanvasTextToImageConfiguration = create<CanvasImageConfiguration>(() => ({ ready: false, loading: true, models: [] }))
export const useCanvasVideoConfiguration = create<{ ready: boolean; imageReady: boolean; loading: boolean; models: VideoModelProfile[] }>(() => ({ ready: false, imageReady: false, loading: true, models: [] }))

interface VariationGateInput {
  generationMode?: string
  cloud?: boolean
  authenticated?: boolean
  configured?: boolean
}

export function isCanvasMockGateway(input?: VariationGateInput) {
  return (input?.generationMode ?? import.meta.env.VITE_GENERATION_MODE) === 'mock'
    && !(input?.cloud ?? cloudEnabled)
}

/** 页面和提交控制器共用能力判断，配置尚未确认时不开放真实入口。 */
export function isFreeCanvasVariationEntryEnabled(input?: VariationGateInput) {
  if (isCanvasMockGateway(input)) return true
  return (input?.authenticated ?? (authEnabled && !!useUserStore.getState().userId))
    && (input?.configured ?? useCanvasVariationConfiguration.getState().ready)
}

export const canSubmitFreeCanvasVariation = isFreeCanvasVariationEntryEnabled

/** 文生图配置独立于裂变，避免其他能力就绪时误开放文生图。 */
export function isFreeCanvasTextToImageEntryEnabled(input?: VariationGateInput) {
  if (isCanvasMockGateway(input)) return true
  return (input?.authenticated ?? (authEnabled && !!useUserStore.getState().userId))
    && (input?.configured ?? useCanvasTextToImageConfiguration.getState().ready)
}

export const canSubmitFreeCanvasTextToImage = isFreeCanvasTextToImageEntryEnabled

export function canSubmitFreeCanvasVideo(mode: 'text_to_video' | 'image_to_video' = 'text_to_video') {
  if (isCanvasMockGateway()) return true
  const config = useCanvasVideoConfiguration.getState()
  return authEnabled && !!useUserStore.getState().userId && (mode === 'image_to_video' ? config.imageReady : config.ready)
}
