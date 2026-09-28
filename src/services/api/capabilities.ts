import { liveCapabilityReady, registerLiveCapability } from '@/services/api/task'
import { cloudEnabled } from '@/cloud/client'
import { Capability } from '@/types'

interface CapabilityFlags {
  bgRemove?: boolean
  outpaint?: boolean
  erase?: boolean
  repaint?: boolean
  imageEdit?: boolean
  smartSelect?: boolean
}

function loadFlags(): Promise<CapabilityFlags> {
  return fetch('/api/capabilities')
    .then(response => response.ok ? response.json() as Promise<CapabilityFlags> : {})
    .catch(() => ({}))
}

export function loadBgRemoveConfigured() {
  if (liveCapabilityReady(Capability.BgRemove)) return Promise.resolve(true)
  return loadFlags().then(data => Boolean(data.bgRemove))
}

export function loadOutpaintConfigured() {
  if (liveCapabilityReady(Capability.Outpaint)) return Promise.resolve(true)
  return loadFlags().then(data => Boolean(data.outpaint))
}

export function loadEraseConfigured() {
  if (liveCapabilityReady(Capability.Inpaint)) return Promise.resolve(true)
  return loadFlags().then(data => Boolean(data.erase))
}

export function loadRepaintConfigured() {
  if (liveCapabilityReady(Capability.Inpaint)) return Promise.resolve(true)
  return loadFlags().then(data => Boolean(data.repaint))
}

export function loadImageEditConfigured() {
  if (liveCapabilityReady(Capability.ImageEdit)) return Promise.resolve(true)
  return loadFlags().then(data => {
    const ready = Boolean(data.imageEdit)
    registerLiveCapability(Capability.ImageEdit, ready)
    return ready
  })
}

export function loadSmartSelectConfigured() {
  if (import.meta.env.VITE_GENERATION_MODE === 'mock' && !cloudEnabled) return Promise.resolve(true)
  return loadFlags().then(data => Boolean(data.smartSelect))
}
