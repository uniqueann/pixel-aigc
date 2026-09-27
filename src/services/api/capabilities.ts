import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'

interface CapabilityFlags {
  bgRemove?: boolean
  outpaint?: boolean
  erase?: boolean
  repaint?: boolean
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
