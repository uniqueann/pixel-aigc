import { suiteRestoreSnapshotRequestSchema } from '../../shared/ecommerce-suite-recovery.js'
import { suiteSaveDraftRequestSchema, suiteVersionSchema } from '../../shared/ecommerce-suite.js'
import { HttpError } from '../errors.js'
import { actor, fingerprint, readSuite, readyAsset, requireSuite, suiteTransaction, validateTemplate, type SuiteUser } from './repository.js'
import { validateSuiteComposition } from './versions.js'

/** 恢复到本账号新项目，仅接收成品与草稿，不导入来源权限、任务或可执行状态。 */
export function restoreSuiteSnapshot(user: SuiteUser, projectId: string, body: unknown) {
  const request = suiteRestoreSnapshotRequestSchema.parse(body)
  validateTemplate(request.config)
  return suiteTransaction(user, async sql => {
    const row = await requireSuite(sql, projectId, true)
    const [receipt] = await sql`select * from aigc.suite_restore_receipts where request_id=${request.requestId}`
    if (receipt) {
      if (receipt.project_id !== projectId || receipt.fingerprint !== fingerprint(request)) throw new HttpError(409, '恢复编号已用于其他内容', 'SUITE_REQUEST_CONFLICT')
      return readSuite(sql, projectId)
    }
    if (row.revision !== 0 || (await sql`select 1 from aigc.suite_versions where project_id=${projectId} limit 1`).length || (await sql`select 1 from aigc.suite_batches where project_id=${projectId} limit 1`).length)
      throw new HttpError(409, '恢复仅限本次创建的空白项目，已有编辑保留，请重新导入为新项目', 'SUITE_REVISION_CONFLICT')
    const current = await readSuite(sql, projectId)
    if (request.config.slots.some(slot => !current.config.slots.some(old => old.id === slot.id && old.key === slot.key && old.kind === slot.kind && old.order === slot.order)))
      throw new HttpError(409, '恢复包槽位身份不一致', 'SUITE_RESULT_CONFLICT')
    const slots = new Set(current.config.slots.map(slot => slot.id)), versions = new Map(request.versions.map(version => [version.id,version]))
    if (versions.size !== request.versions.length || new Set(request.heads.map(head => head.slotId)).size !== 7 || request.heads.some(head => !slots.has(head.slotId) || head.activeVersionId && versions.get(head.activeVersionId)?.slotId !== head.slotId))
      throw new HttpError(400, '恢复指针或版本身份无效', 'SUITE_RESULT_CONFLICT')
    for (const assetId of new Set([request.config.baseAssetId,...request.config.slots.flatMap(slot => slot.referenceAssetIds),...request.versions.map(version => version.assetId)])) await readyAsset(sql, projectId, assetId)
    const sequenceKeys = new Set<string>()
    for (const imported of [...request.versions].sort((a,b) => a.versionNumber-b.versionNumber)) {
      const sequenceKey = `${imported.slotId}:${imported.versionNumber}`
      if (!slots.has(imported.slotId) || sequenceKeys.has(sequenceKey) || imported.parentVersionId && (versions.get(imported.parentVersionId)?.slotId !== imported.slotId || versions.get(imported.parentVersionId)!.versionNumber >= imported.versionNumber))
        throw new HttpError(400, '恢复版本顺序或父引用无效', 'SUITE_RESULT_CONFLICT')
      sequenceKeys.add(sequenceKey)
      validateSuiteComposition(request.config, imported.slotId, imported.composition, [...request.config.facts, ...imported.composition.factsSnapshot])
      const version = suiteVersionSchema.parse({ ...imported, projectId, source: 'reuse', createdAt: new Date().toISOString() })
      await sql`insert into aigc.suite_versions(id,user_id,scope,project_id,slot_id,asset_id,parent_version_id,version_number,application_key,snapshot)
        values(${version.id},${user.id},${actor(user).runtimeScope},${projectId},${version.slotId},${version.assetId},${version.parentVersionId},${version.versionNumber},${`restore:${request.requestId}:${version.id}`},${sql.json(version as never)})`
    }
    for (const head of request.heads) if (head.activeVersionId) await sql`update aigc.suite_slots set active_version_id=${head.activeVersionId},head_revision=1 where project_id=${projectId} and id=${head.slotId}`
    if (new Set(request.drafts.map(item => item.slotId)).size !== request.drafts.length) throw new HttpError(400, '恢复草稿重复', 'SUITE_RESULT_CONFLICT')
    for (const draft of request.drafts) {
      if (!slots.has(draft.slotId) || draft.value.baseVersionId && versions.get(draft.value.baseVersionId)?.slotId !== draft.slotId) throw new HttpError(400, '恢复草稿基准无效', 'SUITE_RESULT_CONFLICT')
      const value = suiteSaveDraftRequestSchema.parse({ ...draft.value, expectedDraftRevision: 0 })
      await sql`update aigc.suite_slots set draft=${sql.json(value as never)},draft_revision=1 where project_id=${projectId} and id=${draft.slotId}`
    }
    await sql`update aigc.suite_projects set config=${sql.json(request.config as never)},revision=1,updated_at=now() where id=${projectId}`
    await sql`insert into aigc.suite_restore_receipts(user_id,scope,project_id,request_id,fingerprint) values(${user.id},${actor(user).runtimeScope},${projectId},${request.requestId},${fingerprint(request)})`
    return readSuite(sql, projectId)
  })
}
