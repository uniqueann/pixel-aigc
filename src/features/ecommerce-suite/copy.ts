import { fetchOwnedObject } from '@/services/api/objects'
import type { SuiteClient } from './api'
import type { SuiteProjectConfig } from '@shared/ecommerce-suite'
import type { SuiteProjectDetail } from '@shared/ecommerce-suite-runtime'
import { readSuiteBlob } from './backup'

/** 复制只上传有权限的图片和配置；不复制任务、版本或收费执行身份。 */
export async function copySuite(client: SuiteClient, detail: SuiteProjectDetail, config = detail.project.config) {
  const actor = detail.project.actor
  const used = [...new Set([config.baseAssetId, ...config.slots.flatMap(slot => slot.referenceAssetIds)])]
  const ids = new Map(used.map(id => [id, crypto.randomUUID()]))
  const blobs = new Map<string, Blob>()
  for (const id of used) {
    const asset = detail.assets.find(asset => asset.assetId === id)
    if (!asset) throw new Error('原项目图片未保存，暂不能复制')
    client.assertCurrent()
    blobs.set(id, await readSuiteBlob(actor, detail.project.id, id) ?? await fetchOwnedObject(asset.objectKey))
  }
  client.assertCurrent()
  const copied: SuiteProjectConfig = { ...config, title: `${config.title.slice(0, 90)} 副本`, baseAssetId: ids.get(config.baseAssetId)!,
    slots: config.slots.map(slot => ({ ...slot, id: crypto.randomUUID(), referenceAssetIds: slot.referenceAssetIds.map(id => ids.get(id)!) })) }
  const initial = { ...copied, slots: copied.slots.map(slot => ({ ...slot, referenceAssetIds: [] })) }
  const project = await client.create(crypto.randomUUID(), initial)
  for (const id of used) await client.upload(project.id, ids.get(id)!, blobs.get(id)!, '复制商品图片')
  return client.update(project.id, project.revision, copied)
}
