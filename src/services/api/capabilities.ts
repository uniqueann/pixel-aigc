import { liveCapabilityReady, registerLiveCapability } from '@/services/api/task'
import { cloudEnabled } from '@/cloud/client'
import { Capability } from '@/types'

export interface CapabilityFlags {
  bgRemove?: boolean
  outpaint?: boolean
  erase?: boolean
  repaint?: boolean
  imageEdit?: boolean
  variation?: boolean
  smartSelect?: boolean
}

export async function loadCapabilityFlags(): Promise<CapabilityFlags> {
  const response = await fetch('/api/capabilities', { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error('功能配置加载失败，请重试')
  const flags = await response.json() as CapabilityFlags
  registerLiveCapability(Capability.ImageEdit, Boolean(flags.imageEdit))
  return flags
}

export function loadBgRemoveConfigured() {
  if (liveCapabilityReady(Capability.BgRemove)) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.bgRemove))
}

export function loadOutpaintConfigured() {
  if (liveCapabilityReady(Capability.Outpaint)) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.outpaint))
}

export function loadEraseConfigured() {
  if (liveCapabilityReady(Capability.Inpaint)) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.erase))
}

export function loadRepaintConfigured() {
  if (liveCapabilityReady(Capability.Inpaint)) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.repaint))
}

export function loadImageEditConfigured() {
  if (liveCapabilityReady(Capability.ImageEdit)) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.imageEdit))
}

/**
 * 只返回工作站开关，不注册到全局任务能力。
 * 裂变提交由 createTask 单独放行；自由画布入口仍由 availability 开关禁用。
 */
export function loadVariationConfigured() {
  if (import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.variation))
}

export function loadSmartSelectConfigured() {
  if (import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled) return Promise.resolve(true)
  return loadCapabilityFlags().then(data => Boolean(data.smartSelect))
}
