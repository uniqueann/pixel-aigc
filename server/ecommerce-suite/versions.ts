import { randomUUID } from 'node:crypto'
import { suiteSaveVersionRequestSchema, suiteVersionSchema, type SuiteComposition, type SuiteProjectConfig } from '../../shared/ecommerce-suite.js'
import { suiteMainLocked } from '../../shared/ecommerce-suite-annotations.js'
import { HttpError } from '../errors.js'
import { actor, assertRevision, fingerprint, readSuite, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'

export function validateSuiteComposition(config: SuiteProjectConfig, slotId: string, composition: SuiteComposition, allowedFacts = config.facts) {
  const slot = config.slots.find(slot => slot.id === slotId)
  if (!slot) throw new HttpError(404, '槽位不存在', 'SUITE_NOT_FOUND')
  if (suiteMainLocked(config, slot) && composition.layersSnapshot.length) throw new HttpError(409, 'Amazon 主图不允许叠加文字或尺寸线，请切换辅助槽位', 'SUITE_MAIN_LOCKED')
  if (composition.factsSnapshot.some(fact => !allowedFacts.some(allowed => allowed.confirmed && fingerprint(allowed) === fingerprint(fact))))
    throw new HttpError(409, '规格尚未确认或已变化，请重新核对商品资料', 'SUITE_FACTS_REQUIRED')
}
/** 图层保存只追加快照；版本重放在指针检查之前找回原版本。 */
export function saveSuiteVersion(user: SuiteUser, projectId: string, slotId: string, body: unknown) {
  const request = suiteSaveVersionRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const project = await readSuite(sql, projectId)
    const [slot] = await sql`select * from aigc.suite_slots where project_id=${projectId} and id=${slotId} for update`
    if (!slot) throw new HttpError(404, '槽位不存在', 'SUITE_NOT_FOUND')
    const application = `annotation:${request.requestId}`
    const [old] = await sql`select snapshot from aigc.suite_versions where project_id=${projectId} and slot_id=${slotId} and application_key=${application}`
    if (old) {
      const version = suiteVersionSchema.parse(old.snapshot)
      if (version.parentVersionId !== request.baseVersionId || fingerprint(version.composition) !== fingerprint(request.composition))
        throw new HttpError(409, '保存编号已用于其他图层修改', 'SUITE_REQUEST_CONFLICT')
      return { version, project }
    }
    assertRevision(slot.head_revision, request.expectedHeadRevision, 'SUITE_HEAD_CONFLICT')
    if (slot.active_version_id !== request.baseVersionId) throw new HttpError(409, '当前版本已改变，图层草稿已保留', 'SUITE_HEAD_CONFLICT')
    if (request.expectedDraftRevision !== undefined) assertRevision(slot.draft_revision, request.expectedDraftRevision)
    const [row] = await sql`select snapshot from aigc.suite_versions where project_id=${projectId} and slot_id=${slotId} and id=${request.baseVersionId}`
    if (!row) throw new HttpError(404, '图层基准版本不存在', 'SUITE_RESULT_CONFLICT')
    const base = suiteVersionSchema.parse(row.snapshot)
    await readyAsset(sql, projectId, base.assetId)
    validateSuiteComposition(project.config, slotId, request.composition, [...project.config.facts, ...base.composition.factsSnapshot])
    if (fingerprint(request.composition.renderSize) !== fingerprint(base.composition.renderSize))
      throw new HttpError(409, '图层编辑不能更换底图画板，请从工作站回填新底图', 'SUITE_RESULT_CONFLICT')
    if (fingerprint({ ...request.composition, rendererVersion: '' }) === fingerprint({ ...base.composition, rendererVersion: '' })) return { version: base, project }
    const [sequence] = await sql`select coalesce(max(version_number),0)+1 as value from aigc.suite_versions where project_id=${projectId} and slot_id=${slotId}`
    const version = suiteVersionSchema.parse({ id: randomUUID(), projectId, slotId, parentVersionId: base.id, assetId: base.assetId,
      versionNumber: Number(sequence.value), source: 'annotation_edit', composition: request.composition, createdAt: new Date().toISOString() })
    await sql`insert into aigc.suite_versions(id,user_id,scope,project_id,slot_id,asset_id,parent_version_id,version_number,application_key,snapshot)
      values(${version.id},${user.id},${actor(user).runtimeScope},${projectId},${slotId},${base.assetId},${base.id},${version.versionNumber},${application},${sql.json(version as never)})`
    await sql`update aigc.suite_slots set active_version_id=${version.id},head_revision=head_revision+1 where project_id=${projectId} and id=${slotId}`
    await sql`update aigc.suite_projects set updated_at=now() where id=${projectId}`
    return { version, project: await readSuite(sql, projectId) }
  })
}
