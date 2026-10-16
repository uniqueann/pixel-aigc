import type { SuiteActor, SuiteAssetRef, SuiteSlotVersion } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { readSuiteBlob } from './backup'
import { fetchOwnedObject } from '@/services/api/objects'
import { createResultZip } from '@/pages/Toolbox/shared/zip'

export async function verifySuiteBlob(blob: Blob, asset: SuiteAssetRef) {
  if (blob.size !== asset.bytes) return false
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('') === asset.checksum
}
export async function loadFullSuite(client: SuiteClient, id: string) {
  const detail = await client.get(id), versions: SuiteSlotVersion[] = []
  for (const slot of detail.project.config.slots) {
    let before: string | null = '2147483647'
    while (before) { const page = await client.versions(id, slot.id, before); versions.push(...page.items); before = page.nextCursor }
  }
  const final = await client.get(id)
  if (final.project.revision !== detail.project.revision || JSON.stringify(final.project.slotHeads) !== JSON.stringify(detail.project.slotHeads)
    || final.versions.some(version => !versions.some(saved => saved.id === version.id)))
    throw new Error('备份期间项目或候选已有更新，请重新备份，当前不会标记完整')
  const references = new Set([final.project.config.baseAssetId, ...final.project.config.slots.flatMap(slot => slot.referenceAssetIds), ...versions.map(version => version.assetId)])
  if ([...references].some(id => !final.assets.some(asset => asset.assetId === id))) throw new Error('部分图片尚未保存，无法形成完整备份')
  return { ...final, versions }
}
export async function backupAssetBlob(actor: SuiteActor, asset: SuiteAssetRef, signal?: AbortSignal) {
  const local = await readSuiteBlob(actor, asset.projectId, asset.assetId).catch(() => undefined)
  if (local && await verifySuiteBlob(local, asset)) return local
  const blob = await fetchOwnedObject(asset.objectKey, undefined, signal)
  if (!await verifySuiteBlob(blob, asset)) throw new Error('图片校验失败，请重新读取原图')
  return blob
}
/** 恢复包只包含配置、版本和图片；不包含可执行批次、报价、提交凭据或签名地址。 */
export async function exportSuiteRecovery(client: SuiteClient, id: string, actor: SuiteActor, signal?: AbortSignal) {
  const detail = await loadFullSuite(client, id)
  const files: { name: string; blob: Blob }[] = []
  const assets = []
  let bytes = 0
  for (const asset of detail.assets) {
    client.assertCurrent()
    if (bytes + asset.bytes > 200 * 1024 * 1024) throw new Error('恢复包超过 200 MB，请分别保存图片并保留云端项目')
    const blob = await backupAssetBlob(actor, asset, signal)
    const name = `images/${asset.assetId}.${asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/webp' ? 'webp' : 'png'}`
    files.push({ name, blob }); bytes += blob.size
    assets.push({ assetId: asset.assetId, mimeType: asset.mimeType, bytes: asset.bytes, size: asset.size, checksum: asset.checksum, file: name })
  }
  const manifest = { format: 'pixel-suite-recovery', formatVersion: 1, config: detail.project.config, slotHeads: detail.project.slotHeads,
    versions: detail.versions, assets, note: '仅保存商品配置、成品和图片，不授予云端权限；不恢复或执行收费任务。恢复包导入在图层阶段接入。' }
  files.push({ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) })
  client.assertCurrent()
  return createResultZip(files)
}
