import type { Transaction } from './db.js'
import type { CloudAsset, CloudProject, ProjectWrite } from '../shared/cloud.js'
import { HttpError } from './errors.js'

export async function requireProject(sql: Transaction, id: string, lock = false) {
  const rows = lock
    ? await sql`select * from aigc.projects where id=${id} and deleted_at is null for update`
    : await sql`select * from aigc.projects where id=${id} and deleted_at is null`
  if (!rows[0]) throw new HttpError(404, '项目不存在或无权访问')
  return rows[0]
}
export function toAsset(row: Record<string, unknown>): CloudAsset {
  return { id: String(row.id), name: String(row.name), mimeType: String(row.mime_type), size: Number(row.size),
    width: Number(row.width), height: Number(row.height), objectKey: String(row.object_key),
    createdAt: new Date(String(row.created_at)).toISOString(), type: 'image', source: 'upload' }
}
export async function validateReferences(sql: Transaction, projectId: string, input: ProjectWrite) {
  const nodes = input.document.scenes.flatMap(scene => scene.nodes)
  const assets = nodes.flatMap(node => node.type === 'image' || node.type === 'video' ? [node.assetId] : node.type === 'generation' && node.outputAssetId ? [node.outputAssetId] : [])
  const derived = input.drafts.derived
  if (derived) {
    if (derived.sourceNode.assetId !== derived.sourceAssetId) throw new HttpError(400, '派生草稿素材不一致')
    assets.push(derived.sourceAssetId)
  }
  if (assets.length) {
    const rows = await sql`select id from aigc.assets where project_id=${projectId} and status='ready' and id in ${sql([...new Set(assets)])}`
    if (rows.length !== new Set(assets).size) throw new HttpError(400, '画布引用了未上传或无权访问的素材')
  }
  if (nodes.some(n => n.type === 'video')) throw new HttpError(400, '本轮云端暂不支持视频素材')
  const generations = nodes.flatMap(n => n.type === 'generation' ? [n.generationId] : [])
  if (generations.length) {
    const rows = await sql`select id from aigc.generations where project_id=${projectId} and id in ${sql([...new Set(generations)])}`
    if (rows.length !== new Set(generations).size) throw new HttpError(400, '不能保存本地模拟任务占位')
  }
}
export async function readProject(sql: Transaction, id: string): Promise<CloudProject> {
  const row = await requireProject(sql, id)
  const assets = await sql`select * from aigc.assets where project_id=${id} and status='ready'`
  return { id, name: row.name, document: row.document, drafts: row.drafts, schemaVersion: row.schema_version,
    revision: row.revision, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), assets: assets.map(toAsset) }
}
