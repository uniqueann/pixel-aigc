import type { CloudAsset } from '../../shared/cloud'
import type { ProjectSnapshot } from '@/editor/persistence/types'
import { cloudRequest } from './client'

export async function accessAssets(projectId: string, assetIds: string[]) {
  const items: { id: string; url: string; expiresAt: number }[] = []
  for (let start = 0; start < assetIds.length; start += 100) {
    const result = await cloudRequest<{ items: typeof items }>('/assets/access', 'POST', { projectId, assetIds: assetIds.slice(start, start + 100) })
    items.push(...result.items)
  }
  return items
}
export async function uploadCloudImage(projectId: string, assetId: string, file: File): Promise<CloudAsset> {
  const result = await cloudRequest<{ uploadUrl?: string; asset?: CloudAsset }>('/assets/uploads', 'POST', {
    projectId, assetId, name: file.name, mimeType: file.type, size: file.size,
  })
  if (result.asset) return result.asset
  const response = await fetch(result.uploadUrl!, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file, signal: AbortSignal.timeout(120000) })
  if (!response.ok) throw new Error('上传素材失败，请重试')
  return (await cloudRequest<{ asset: CloudAsset }>(`/assets/${encodeURIComponent(assetId)}/complete`, 'POST', { projectId })).asset
}
export const assetPlaceholder = (id: string) => `/__aigc_asset__/${encodeURIComponent(id)}`
export async function hydrateAssets(snapshot: ProjectSnapshot): Promise<ProjectSnapshot> {
  const copy = structuredClone(snapshot)
  const ids = Object.values(copy.project.assets).filter(asset => asset.storage?.provider === 'r2').map(asset => asset.id)
  if (!ids.length) return copy
  try {
    const groups = new Map<string, string[]>()
    for (const id of ids) {
      const source = copy.project.assets[id].storage!.projectId
      groups.set(source, [...(groups.get(source) ?? []), id])
    }
    const access = (await Promise.all([...groups].map(([projectId, assetIds]) => accessAssets(projectId, assetIds)))).flat()
    for (const item of access) copy.project.assets[item.id] = { ...copy.project.assets[item.id], url: item.url, accessExpiresAt: item.expiresAt, missing: false }
  } catch {
    for (const id of ids) copy.project.assets[id].missing = true
  }
  return copy
}
