import { cloudEnabled } from '@/cloud/client'

interface VariationGateInput {
  mode?: string
  generationMode?: string
  cloud?: boolean
}

function gateInput(input?: VariationGateInput) {
  return {
    mode: input?.mode ?? import.meta.env.MODE,
    generationMode: input?.generationMode ?? import.meta.env.VITE_GENERATION_MODE,
    cloud: input?.cloud ?? cloudEnabled,
  }
}

/** 节点上的裂变入口。只有模拟网关可以点开并提交。 */
export function isFreeCanvasVariationEntryEnabled(input?: VariationGateInput) {
  const gate = gateInput(input)
  return gate.generationMode === 'mock' && !gate.cloud
}

/**
 * 提交前的第二道开关。测试环境放行，是为了保留现有自由画布裂变单测；
 * 开发和生产在非模拟模式下拒绝，不调用 /api/tasks。
 */
export function canSubmitFreeCanvasVariation(input?: VariationGateInput) {
  const gate = gateInput(input)
  if (gate.mode === 'test') return true
  return gate.generationMode === 'mock' && !gate.cloud
}
