import { z } from 'zod'
import { suiteCompositionSchema, suiteProjectConfigSchema, suiteSaveDraftRequestSchema, suiteVersionSchema } from './ecommerce-suite.js'

const head = z.object({ slotId: z.uuid(), activeVersionId: z.uuid().nullable(), headRevision: z.number().int().nonnegative() }).strict()
const draft = z.object({ slotId: z.uuid(), value: suiteSaveDraftRequestSchema }).strict()
export const suiteRecoveryManifestSchema = z.object({
  format: z.literal('pixel-suite-recovery'), formatVersion: z.literal(1), config: suiteProjectConfigSchema,
  slotHeads: z.array(head).length(7), versions: z.array(suiteVersionSchema).max(2000), drafts: z.array(draft).max(7).optional(),
  draftArchives: z.array(draft).max(1000).optional(),
  assets: z.array(z.object({ assetId: z.uuid(), mimeType: z.enum(['image/jpeg','image/png','image/webp']), bytes: z.number().int().positive().max(20*1024*1024),
    size: z.object({ width: z.number().int().positive().max(10000), height: z.number().int().positive().max(10000) }).strict(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/), file: z.string().regex(/^images\/[0-9a-f-]{36}\.(png|jpg|webp)$/) }).strict()).max(2000),
  note: z.string().max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  const slots = new Set(value.config.slots.map(slot => slot.id)), assets = new Set(value.assets.map(asset => asset.assetId)), versions = new Map(value.versions.map(version => [version.id,version]))
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message })
  if (assets.size !== value.assets.length || versions.size !== value.versions.length || new Set(value.assets.map(asset => asset.file)).size !== value.assets.length) fail('图片或版本身份重复')
  if (new Set(value.slotHeads.map(item => item.slotId)).size !== 7 || value.slotHeads.some(item => !slots.has(item.slotId))) fail('恢复包槽位指针不完整')
  if (value.slotHeads.some(item => item.activeVersionId && versions.get(item.activeVersionId)?.slotId !== item.slotId)) fail('当前指针引用其他槽位或缺失版本')
  if ([value.config.baseAssetId,...value.config.slots.flatMap(slot => slot.referenceAssetIds),...value.versions.map(version => version.assetId)].some(id => !assets.has(id))) fail('恢复包缺少引用图片')
  if (value.versions.some(version => !slots.has(version.slotId) || version.parentVersionId && (versions.get(version.parentVersionId)?.slotId !== version.slotId || versions.get(version.parentVersionId)!.versionNumber >= version.versionNumber))) fail('历史版本的父引用无效')
  if (value.drafts && (new Set(value.drafts.map(item => item.slotId)).size !== value.drafts.length || value.drafts.some(item => !slots.has(item.slotId) || item.value.baseVersionId && versions.get(item.value.baseVersionId)?.slotId !== item.slotId))) fail('草稿基准无效')
  if (value.draftArchives?.some(item => !slots.has(item.slotId) || item.value.baseVersionId && versions.get(item.value.baseVersionId)?.slotId !== item.slotId)) fail('归档草稿基准无效')
})
export const suiteRestoreSnapshotRequestSchema = z.object({
  requestId: z.uuid(), config: suiteProjectConfigSchema,
  versions: z.array(z.object({ id: z.uuid(), slotId: z.uuid(), parentVersionId: z.uuid().nullable(), assetId: z.uuid(), versionNumber: z.number().int().positive().max(2147483647), composition: suiteCompositionSchema }).strict()).max(2000),
  heads: z.array(head.pick({ slotId: true, activeVersionId: true })).length(7), drafts: z.array(draft).max(7),
}).strict()
export type SuiteRecoveryManifest = z.infer<typeof suiteRecoveryManifestSchema>
export type SuiteRestoreSnapshotRequest = z.infer<typeof suiteRestoreSnapshotRequestSchema>
