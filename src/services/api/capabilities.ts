import { liveCapabilityReady } from '@/services/api/task'
import { Capability } from '@/types'

export function loadBgRemoveConfigured() {
  if (liveCapabilityReady(Capability.BgRemove)) return Promise.resolve(true)
  return fetch('/api/capabilities')
    .then(response => response.ok ? response.json() as Promise<{ bgRemove?: boolean }> : { bgRemove: false })
    .then(data => Boolean(data.bgRemove))
    .catch(() => false)
}
