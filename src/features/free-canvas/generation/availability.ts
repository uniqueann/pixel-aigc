import { create } from 'zustand'
import { authEnabled, cloudEnabled } from '@/cloud/client'
import { useUserStore } from '@/store/useUserStore'
import type { PublicImageModel } from '@/services/api/imageModels'

export const useCanvasVariationConfiguration = create<{
  ready: boolean; loading: boolean; models: PublicImageModel[]; error?: string
}>(() => ({ ready: false, loading: true, models: [] }))

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
