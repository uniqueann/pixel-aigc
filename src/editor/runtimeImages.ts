import type { ImageAsset } from './types'
import { useEditorStore } from './store'
import { useUserStore } from '@/store/useUserStore'
import { retainImageBlob } from '@/services/api/imageRuntime'
const images = new Map<string, { ownerId: string; blob: Blob; pendingFor?: object; lease: ReturnType<typeof retainImageBlob> }>()
const users = new Map<object, Set<string>>()
function prune() {
  const project = useEditorStore.getState().project
  const referenced = new Set([...users.values()].flatMap(ids => [...ids]))
  for (const scene of project?.document.scenes ?? []) for (const node of scene.nodes) {
    if (node.type === 'image') referenced.add(node.assetId)
  }
  for (const [id, entry] of images) {
    if (!project?.assets[id] || (!referenced.has(id) && (!entry.pendingFor || !users.has(entry.pendingFor)))) { entry.lease.release(); images.delete(id) }
  }
}
export function setRuntimeImageUsers(user: object, ids: string[]) {
  users.set(user, new Set(ids))
  for (const id of ids) {
    const entry = images.get(id)
    if (entry?.pendingFor === user) entry.pendingFor = undefined
  }
  prune()
}
export function abandonPendingRuntimeImages(user: object) {
  for (const entry of images.values()) if (entry.pendingFor === user) entry.pendingFor = undefined
  prune()
}
export function releaseRuntimeImageUser(user: object) { users.delete(user); prune() }
export function bindRuntimeImage(ownerId: string, asset: ImageAsset, blob: Blob, user: object) {
  if (images.get(asset.id)?.blob === blob) return
  images.get(asset.id)?.lease.release()
  images.set(asset.id, { ownerId, blob, pendingFor: user, lease: retainImageBlob(blob) })
}
export function withRuntimeImage(asset: ImageAsset, ownerId?: string): ImageAsset {
  const entry = images.get(asset.id)
  return entry && (!ownerId || entry.ownerId === ownerId) ? { ...asset, url: entry.lease.url } : asset
}
useEditorStore.subscribe(state => {
  for (const [id, entry] of images) if (!state.project?.assets[id]) { entry.lease.release(); images.delete(id) }
})
useUserStore.subscribe((state, previous) => {
  if (state.userId === previous.userId) return
  for (const entry of images.values()) entry.lease.release()
  images.clear(); users.clear()
})
