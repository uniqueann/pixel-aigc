import { suiteRecoveryManifestSchema, type SuiteRecoveryManifest, type SuiteRestoreSnapshotRequest } from '@shared/ecommerce-suite-recovery'
import { detectImageMime } from '@shared/image-format'
import type { SuiteActor } from '@shared/ecommerce-suite'
import type { FileEntry } from '@zip.js/zip.js'
import type { SuiteClient } from './api'
import { archiveSuiteDraft, saveSuiteBlob } from './backup'
import { verifySuiteBlob } from './recoveryPackage'

const MAX = 200 * 1024 * 1024
async function readEntry(entry: FileEntry, cap: number, mime = 'application/json') {
  let bytes = 0
  const chunks: Uint8Array<ArrayBuffer>[] = []
  await entry.getData(new WritableStream<Uint8Array>({ write(chunk) {
    bytes += chunk.length
    if (bytes > cap) throw new Error('恢复包解压后超出大小限制')
    chunks.push(new Uint8Array(chunk))
  } }), { checkSignature: true, useWebWorkers: false })
  if (bytes !== entry.uncompressedSize) throw new Error('恢复包文件大小与清单不一致')
  return new Blob(chunks, { type: mime })
}
export async function inspectRecoveryImage(blob: Blob) {
  const mimeType = detectImageMime(new Uint8Array(await blob.slice(0,32).arrayBuffer()))
  if (!mimeType) throw new Error('恢复包图片格式无效')
  const decoded = await createImageBitmap(blob)
  try {
    if (decoded.width * decoded.height > 40_000_000) throw new Error('恢复图片超过 4000 万像素')
    return { width: decoded.width, height: decoded.height, mimeType }
  } finally { decoded.close() }
}
/** 校验完成前不创建云端项目，不解析或执行恢复包中的任务身份。 */
export async function readSuiteRecovery(file: Blob, inspect = inspectRecoveryImage) {
  if (file.size > MAX) throw new Error('恢复包不能超过 200 MB')
  const { BlobReader, ZipReader } = await import('@zip.js/zip.js')
  const zip = new ZipReader(new BlobReader(file), { useWebWorkers: false })
  try {
    const entries = await zip.getEntries()
    if (entries.length > 2001 || entries.some(entry => entry.directory || entry.encrypted || !/^(manifest\.json|images\/[0-9a-f-]{36}\.(jpg|png|webp))$/.test(entry.filename))
      || new Set(entries.map(entry => entry.filename)).size !== entries.length || entries.reduce((sum,entry) => sum+entry.uncompressedSize,0) > MAX)
      throw new Error('恢复包含重复、加密、不安全或超限文件')
    const manifestEntry = entries.find(entry => entry.filename === 'manifest.json')
    if (!manifestEntry || manifestEntry.directory || manifestEntry.uncompressedSize > 8 * 1024 * 1024) throw new Error('恢复包缺少有效清单或清单过大')
    const parsed = suiteRecoveryManifestSchema.safeParse(JSON.parse(await (await readEntry(manifestEntry, 8*1024*1024)).text()))
    if (!parsed.success) throw new Error('恢复包清单无效，请检查版本、图片引用、槽位和图层数据')
    const manifest = parsed.data
    if (entries.length !== manifest.assets.length + 1) throw new Error('恢复包包含清单外文件')
    const images = new Map<string, Blob>()
    let total = 0
    for (const asset of manifest.assets) {
      const entry = entries.find(entry => entry.filename === asset.file)
      if (!entry || entry.directory || entry.uncompressedSize !== asset.bytes) throw new Error('恢复包缺少图片或字节数不一致')
      const blob = await readEntry(entry, Math.min(asset.bytes, MAX-total), asset.mimeType)
      total += blob.size
      if (!await verifySuiteBlob(blob, asset)) throw new Error('恢复包图片校验值不一致')
      const actual = await inspect(blob)
      if (actual.mimeType !== asset.mimeType || actual.width !== asset.size.width || actual.height !== asset.size.height) throw new Error('恢复包图片的真实格式或像素不一致')
      images.set(asset.assetId, blob)
    }
    return { manifest, images }
  } finally { await zip.close() }
}
async function recoveryId(seed: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed))
  const hex = [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2,'0')).join('')
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`
}
export async function importSuiteRecovery(client: SuiteClient, actor: SuiteActor, input: { manifest: SuiteRecoveryManifest; images: Map<string,Blob> }, fileDigest: string) {
  const { manifest, images } = input
  const seed = `${actor.userId}:${actor.runtimeScope}:${fileDigest}`
  const slots = new Map<string,string>(), assets = new Map<string,string>(), versions = new Map<string,string>()
  for (const slot of manifest.config.slots) slots.set(slot.id, await recoveryId(`${seed}:slot:${slot.id}`))
  for (const asset of manifest.assets) assets.set(asset.assetId, await recoveryId(`${seed}:asset:${asset.assetId}`))
  for (const version of manifest.versions) versions.set(version.id, await recoveryId(`${seed}:version:${version.id}`))
  const config = { ...manifest.config, title: `${manifest.config.title.slice(0,88)} 恢复副本`, baseAssetId: assets.get(manifest.config.baseAssetId)!,
    slots: manifest.config.slots.map(slot => ({ ...slot, id: slots.get(slot.id)!, referenceAssetIds: slot.referenceAssetIds.map(id => assets.get(id)!) })) }
  const request: SuiteRestoreSnapshotRequest = { requestId: await recoveryId(`${seed}:restore`), config,
    versions: manifest.versions.map(version => ({ id: versions.get(version.id)!, slotId: slots.get(version.slotId)!, parentVersionId: version.parentVersionId ? versions.get(version.parentVersionId)! : null,
      assetId: assets.get(version.assetId)!, versionNumber: version.versionNumber, composition: version.composition })),
    heads: manifest.slotHeads.map(head => ({ slotId: slots.get(head.slotId)!, activeVersionId: head.activeVersionId ? versions.get(head.activeVersionId)! : null })),
    drafts: (manifest.drafts ?? []).map(draft => ({ slotId: slots.get(draft.slotId)!, value: { ...draft.value, expectedDraftRevision: 0, baseVersionId: draft.value.baseVersionId ? versions.get(draft.value.baseVersionId)! : null } })) }
  if (new TextEncoder().encode(JSON.stringify(request)).length > 3 * 1024 * 1024) throw new Error('版本元数据超过单次恢复的 3 MiB 上限，请保留恢复包；本次尚未创建云端项目')
  client.assertCurrent()
  const project = await client.create(await recoveryId(`${seed}:create`), { ...config, slots: config.slots.map(slot => ({ ...slot, referenceAssetIds: [] })) })
  for (const asset of manifest.assets) {
    client.assertCurrent()
    const blob = images.get(asset.assetId)!
    await client.upload(project.id, assets.get(asset.assetId)!, blob, '恢复包图片')
    await saveSuiteBlob(actor, project.id, assets.get(asset.assetId)!, blob).catch(() => undefined)
  }
  const restored = await client.restoreSnapshot(project.id, request)
  for (const draft of manifest.draftArchives ?? []) {
    client.assertCurrent()
    await archiveSuiteDraft(actor, project.id, slots.get(draft.slotId)!, { dirty: false, value: { ...draft.value, expectedDraftRevision: 0, baseVersionId: draft.value.baseVersionId ? versions.get(draft.value.baseVersionId)! : null } })
  }
  return restored
}
