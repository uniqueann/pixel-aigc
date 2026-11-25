import { i18n } from '@/i18n'
import { formatMegabytes } from '@/i18n/format'
import type { SuiteActor, SuiteAssetRef, SuiteSlotVersion } from '@shared/ecommerce-suite'
import type { SuiteClient } from './api'
import { listArchivedSuiteDrafts, readSuiteBlob } from './backup'
import { fetchOwnedObject } from '@/services/api/objects'
import { createResultZip } from '@/pages/Toolbox/shared/zip'

const MAX_PACKAGE_BYTES = 200 * 1024 * 1024

export async function verifySuiteBlob(blob: Blob, asset: Pick<SuiteAssetRef, 'bytes' | 'checksum'>) {
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
    throw new Error(i18n.t('ecommerce:backup.errors.changedDuringBackup'))
  const references = new Set([final.project.config.baseAssetId, ...final.project.config.slots.flatMap(slot => slot.referenceAssetIds), ...versions.map(version => version.assetId)])
  if ([...references].some(id => !final.assets.some(asset => asset.assetId === id))) throw new Error(i18n.t('ecommerce:backup.errors.missingImages'))
  return { ...final, versions }
}
export async function backupAssetBlob(actor: SuiteActor, asset: SuiteAssetRef, signal?: AbortSignal) {
  const local = await readSuiteBlob(actor, asset.projectId, asset.assetId).catch(() => undefined)
  if (local && await verifySuiteBlob(local, asset)) return local
  const blob = await fetchOwnedObject(asset.objectKey, undefined, signal)
  if (!await verifySuiteBlob(blob, asset)) throw new Error(i18n.t('ecommerce:backup.errors.checksumFailed'))
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
    if (bytes + asset.bytes > MAX_PACKAGE_BYTES) throw new Error(i18n.t('ecommerce:backup.errors.packageTooLarge', { limit: formatMegabytes(MAX_PACKAGE_BYTES) }))
    const blob = await backupAssetBlob(actor, asset, signal)
    const name = `images/${asset.assetId}.${asset.mimeType === 'image/jpeg' ? 'jpg' : asset.mimeType === 'image/webp' ? 'webp' : 'png'}`
    files.push({ name, blob }); bytes += blob.size
    assets.push({ assetId: asset.assetId, mimeType: asset.mimeType, bytes: asset.bytes, size: asset.size, checksum: asset.checksum, file: name })
  }
  const manifest = { format: 'pixel-suite-recovery', formatVersion: 1, config: detail.project.config, slotHeads: detail.project.slotHeads,
    draftArchives: (await listArchivedSuiteDrafts(actor, id)).map(draft => ({ slotId: draft.slotId, value: draft.value })),
    versions: detail.versions, assets, drafts: detail.drafts.filter(draft => draft.value).map(draft => ({ slotId: draft.slotId, value: draft.value })),
    note: i18n.t('ecommerce:backup.recoveryManifestNote') }
  files.push({ name: 'manifest.json', blob: new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' }) })
  client.assertCurrent()
  return createResultZip(files)
}
