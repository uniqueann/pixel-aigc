import { createHash } from 'node:crypto'
import type { authenticate } from '../auth.js'
import { runtimeScope, withIdentity, type Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { requireActive } from '../members.js'
import { suiteAssetSchema, suiteProjectSchema, type SuiteProjectConfig } from '../../shared/ecommerce-suite.js'
import { SUITE_CATEGORY_TEMPLATES } from '../../shared/ecommerce-suite-templates.js'

export type SuiteUser = Awaited<ReturnType<typeof authenticate>>
export const actor = (user: SuiteUser) => ({ userId: user.id, runtimeScope: runtimeScope() })
export const instant = (value: unknown) => new Date(value as string | Date).toISOString()
export function fingerprint(value: unknown): string {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)).map(([key, nested]) => [key, canonical(nested)])) : item
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}
export function suiteTransaction<T>(user: SuiteUser, action: (sql: Transaction) => Promise<T>): Promise<T> {
  return withIdentity(user.id, user.email, async sql => {
    await sql`select set_config('statement_timeout','8000',true),set_config('lock_timeout','5000',true)`
    await requireActive(sql, user.id)
    return action(sql)
  })
}
export async function requireSuite(sql: Transaction, projectId: string, lock = false, includeDeleted = false) {
  const [row] = await sql`select * from aigc.suite_projects where id=${projectId}
    and purge_started_at is null and (${includeDeleted} or deleted_at is null) ${lock ? sql`for update` : sql``}`
  if (!row) throw new HttpError(404, '套图项目不存在或无权访问', 'SUITE_NOT_FOUND')
  return row
}
export async function readSuite(sql: Transaction, projectId: string, includeDeleted = false) {
  const row = await requireSuite(sql, projectId, false, includeDeleted)
  const heads = await sql`select id,active_version_id,head_revision from aigc.suite_slots where project_id=${projectId} order by slot_order`
  return suiteProjectSchema.parse({ id: row.id, actor: { userId: row.user_id, runtimeScope: row.scope },
    revision: row.revision, config: row.config, createdAt: instant(row.created_at), updatedAt: instant(row.updated_at),
    deletedAt: row.deleted_at ? instant(row.deleted_at) : null,
    slotHeads: heads.map(head => ({ slotId: head.id, activeVersionId: head.active_version_id, headRevision: head.head_revision })),
  })
}
export function toSuiteAsset(row: Record<string, unknown>) {
  return suiteAssetSchema.parse({ assetId: row.id, projectId: row.project_id,
    actor: { userId: row.user_id, runtimeScope: row.scope }, objectKey: row.object_key, mimeType: row.mime_type,
    size: { width: row.width, height: row.height }, bytes: Number(row.bytes), checksum: row.checksum })
}
export async function readyAsset(sql: Transaction, projectId: string, assetId: string) {
  const [row] = await sql`select * from aigc.suite_assets where project_id=${projectId} and id=${assetId} and status='ready' and purged_at is null`
  if (!row) throw new HttpError(409, '商品图片尚未持久保存或资源不可用，请上传后重试', 'SUITE_ASSET_UNAVAILABLE')
  return toSuiteAsset(row)
}
export function validateTemplate(config: SuiteProjectConfig) {
  const template = SUITE_CATEGORY_TEMPLATES[config.subcategory]
  if (config.slots.some(slot => !template.slots.some(item => item.key === slot.key && item.kind === slot.kind)))
    throw new HttpError(400, '槽位语义与所选类目模板不一致', 'INVALID_REQUEST')
}
export function assertRevision(actual: number, expected: number, code = 'SUITE_REVISION_CONFLICT') {
  if (actual !== expected) throw new HttpError(409, '云端已有更新，本机编辑已保留，请读取云端或另存副本', code)
}
