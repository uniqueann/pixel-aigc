import { randomUUID } from 'node:crypto'
import { suiteBatchSchema, suiteCreateProjectRequestSchema, suiteOperationSchema, suiteSaveDraftRequestSchema, suiteSetCurrentRequestSchema,
  suiteUpdateProjectRequestSchema, suiteVersionSchema } from '../../shared/ecommerce-suite.js'
import type { SuiteProjectDetail, SuiteProjectList } from '../../shared/ecommerce-suite-runtime.js'
import { taskRepository } from '../task-center/repository.js'
import { HttpError } from '../errors.js'
import { actor, assertRevision, fingerprint, readSuite, requireSuite, suiteTransaction, toSuiteAsset, validateTemplate, type SuiteUser } from './repository.js'
import { suiteMainLocked } from '../../shared/ecommerce-suite-annotations.js'

export async function createSuite(user: SuiteUser, body: unknown) {
  const request = suiteCreateProjectRequestSchema.parse(body)
  validateTemplate(request.config)
  return suiteTransaction(user, async sql => {
    await sql`select pg_advisory_xact_lock(hashtextextended(${`${user.id}:${actor(user).runtimeScope}:${request.requestId}`},0))`
    const [old] = await sql`select id,request_fingerprint from aigc.suite_projects where create_request_id=${request.requestId}`
    const hash = fingerprint(request.config)
    if (old) {
      if (old.request_fingerprint !== hash) throw new HttpError(409, '创建请求已用于其他配置', 'SUITE_REQUEST_CONFLICT')
      return readSuite(sql, String(old.id))
    }
    const id = randomUUID()
    // 主体资产 ID 在创建时预留；没有 ready 资产的草稿不能报价或生成。
    if (request.config.slots.some(slot => slot.referenceAssetIds.length)) throw new HttpError(400, '请在项目创建后添加参考图', 'INVALID_REQUEST')
    await sql`insert into aigc.suite_projects(id,user_id,scope,create_request_id,request_fingerprint,config)
      values(${id},${user.id},${actor(user).runtimeScope},${request.requestId},${hash},${sql.json(request.config as never)})`
    for (const slot of request.config.slots) await sql`insert into aigc.suite_slots(id,user_id,scope,project_id,key,kind,slot_order,enabled)
      values(${slot.id},${user.id},${actor(user).runtimeScope},${id},${slot.key},${slot.kind},${slot.order},${slot.enabled})`
    return readSuite(sql, id)
  })
}
export function updateSuite(user: SuiteUser, id: string, body: unknown) {
  const request = suiteUpdateProjectRequestSchema.parse(body)
  validateTemplate(request.config)
  return suiteTransaction(user, async sql => {
    const old = await requireSuite(sql, id, true)
    assertRevision(old.revision, request.expectedRevision)
    const current = await readSuite(sql, id)
    if (request.config.subcategory !== current.config.subcategory)
      throw new HttpError(409, '已保存项目的类目模板不能更换，请复制配置为新项目', 'SUITE_REVISION_CONFLICT')
    if (request.config.slots.some(slot => !current.config.slots.some(item => item.id === slot.id && item.key === slot.key && item.order === slot.order)))
      throw new HttpError(409, '现有槽位身份与顺序不能更换，请新建项目', 'SUITE_REVISION_CONFLICT')
    const references = new Set(request.config.slots.flatMap(slot => slot.referenceAssetIds))
    if (request.config.baseAssetId !== current.config.baseAssetId) references.add(request.config.baseAssetId)
    for (const assetId of references) {
      const [asset] = await sql`select id from aigc.suite_assets where id=${assetId} and project_id=${id} and status='ready'`
      if (!asset) throw new HttpError(409, '配置引用的图片尚未保存到本项目', 'SUITE_ASSET_UNAVAILABLE')
    }
    await sql`update aigc.suite_projects set config=${sql.json(request.config as never)},revision=revision+1,updated_at=now() where id=${id}`
    for (const slot of request.config.slots) await sql`update aigc.suite_slots set kind=${slot.kind},enabled=${slot.enabled} where project_id=${id} and id=${slot.id}`
    return readSuite(sql, id)
  })
}
export function findSuiteByRequest(user: SuiteUser, requestId: string) {
  return suiteTransaction(user, async sql => {
    const [row] = await sql`select id from aigc.suite_projects where create_request_id=${requestId} and deleted_at is null`
    return row ? readSuite(sql, String(row.id)) : null
  })
}
export function listSuites(user: SuiteUser, page: number, deleted = false): Promise<SuiteProjectList> {
  return suiteTransaction(user, async sql => {
    const rows = await sql`select id from aigc.suite_projects where (deleted_at is not null)=${deleted} and purge_started_at is null
      order by updated_at desc,id desc limit 21 offset ${(page - 1) * 20}`
    const items: SuiteProjectList['items'] = []
    for (const row of rows.slice(0, 20)) {
      const project = await readSuite(sql, String(row.id), deleted)
      const [base] = await sql`select id from aigc.suite_assets where project_id=${project.id} and id=${project.config.baseAssetId} and status='ready'`
      items.push({ project, readySlots: project.slotHeads.filter(head => head.activeVersionId && project.config.slots.some(slot => slot.id === head.slotId && slot.enabled)).length,
        enabledSlots: project.config.slots.filter(slot => slot.enabled).length, baseReady: Boolean(base) })
    }
    return { items, nextCursor: rows.length > 20 ? String(page + 1) : null }
  })
}
export function getSuite(user: SuiteUser, id: string): Promise<SuiteProjectDetail> {
  return suiteTransaction(user, async sql => {
    const project = await readSuite(sql, id)
    const assets = (await sql`select * from aigc.suite_assets where project_id=${id} and status='ready'`).map(toSuiteAsset)
    const versions = (await sql`select snapshot from aigc.suite_versions where project_id=${id}
      and (id in (select active_version_id from aigc.suite_slots where project_id=${id})
        or id in (select nullif(draft->>'baseVersionId','')::uuid from aigc.suite_slots where project_id=${id})
        or id in (select id from aigc.suite_versions where project_id=${id} order by created_at desc limit 28)) order by created_at desc`).map(row => suiteVersionSchema.parse(row.snapshot))
    const drafts = (await sql`select id,draft,draft_revision from aigc.suite_slots where project_id=${id}`).map(row => ({ slotId: String(row.id), revision: Number(row.draft_revision), value: row.draft ? suiteSaveDraftRequestSchema.parse(row.draft) : null }))
    const batches = (await sql`select snapshot from aigc.suite_batches where project_id=${id} order by created_at desc limit 30`).map(row => suiteBatchSchema.parse(row.snapshot))
    const operations = (await sql`select snapshot from aigc.suite_operations where project_id=${id}
      and batch_id in ${sql(batches.map(batch => batch.id).length ? batches.map(batch => batch.id) : ['00000000-0000-4000-8000-000000000000'])}`).map(row => suiteOperationSchema.parse(row.snapshot))
    const repository = taskRepository({ query: (text, params) => sql.unsafe(text, params as never[]) }, user.id, actor(user).runtimeScope)
    const tasks = await repository.projectChildren(id)
    return { project, assets, versions, drafts, batches, operations, tasks }
  })
}
export function saveSuiteDraft(user: SuiteUser, id: string, slotId: string, body: unknown) {
  const request = suiteSaveDraftRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, id, true)
    const project = await readSuite(sql, id)
    const [slot] = await sql`select draft_revision,draft from aigc.suite_slots where project_id=${id} and id=${slotId} for update`
    if (!slot) throw new HttpError(404, '槽位不存在', 'SUITE_NOT_FOUND')
    assertRevision(slot.draft_revision, request.expectedDraftRevision)
    if (suiteMainLocked(project.config, project.config.slots.find(item => item.id === slotId)!) && request.layers.length && fingerprint(slot.draft?.layers ?? []) !== fingerprint(request.layers))
      throw new HttpError(409, 'Amazon 主图的叠加图层已锁定，原草稿仍保留', 'SUITE_MAIN_LOCKED')
    if (request.baseVersionId && !(await sql`select 1 from aigc.suite_versions where project_id=${id} and slot_id=${slotId} and id=${request.baseVersionId}`).length)
      throw new HttpError(400, '草稿基准不属于当前槽位', 'SUITE_RESULT_CONFLICT')
    await sql`update aigc.suite_slots set draft=${sql.json(request as never)},draft_revision=draft_revision+1 where id=${slotId} and project_id=${id}`
    return { slotId, revision: request.expectedDraftRevision + 1, value: request }
  })
}
export function selectSuiteVersion(user: SuiteUser, id: string, slotId: string, body: unknown) {
  const request = suiteSetCurrentRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, id, true)
    const [slot] = await sql`select * from aigc.suite_slots where id=${slotId} and project_id=${id} for update`
    if (!slot) throw new HttpError(404, '槽位不存在', 'SUITE_NOT_FOUND')
    assertRevision(slot.head_revision, request.expectedHeadRevision, 'SUITE_HEAD_CONFLICT')
    if (!(await sql`select 1 from aigc.suite_versions v join aigc.suite_assets a on a.id=v.asset_id and a.project_id=v.project_id
      where v.id=${request.versionId} and v.project_id=${id} and v.slot_id=${slotId} and a.status='ready'`).length)
      throw new HttpError(409, '候选版本不可用或不属于当前槽位', 'SUITE_RESULT_CONFLICT')
    const project = await readSuite(sql, id)
    const [candidate] = await sql`select snapshot from aigc.suite_versions where id=${request.versionId} and project_id=${id} and slot_id=${slotId}`
    if (suiteMainLocked(project.config, project.config.slots.find(item => item.id === slotId)!) && suiteVersionSchema.parse(candidate.snapshot).composition.layersSnapshot.length)
      throw new HttpError(409, 'Amazon 主图不能选用带叠加图层的版本，历史仍保留', 'SUITE_MAIN_LOCKED')
    await sql`update aigc.suite_slots set active_version_id=${request.versionId},head_revision=head_revision+1 where id=${slotId} and project_id=${id}`
    return readSuite(sql, id)
  })
}
export function listSuiteVersions(user: SuiteUser, id: string, slotId: string, before: number) {
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, id)
    const rows = await sql`select snapshot,version_number from aigc.suite_versions where project_id=${id} and slot_id=${slotId}
      and version_number<${before} order by version_number desc limit 21`
    return { items: rows.slice(0, 20).map(row => suiteVersionSchema.parse(row.snapshot)), nextCursor: rows.length > 20 ? String(rows[19].version_number) : null }
  })
}
export function recycleSuite(user: SuiteUser, id: string, restore: boolean) {
  return suiteTransaction(user, async sql => {
    const row = await requireSuite(sql, id, true, true)
    const [valid] = await sql`select deleted_at is null or deleted_at>clock_timestamp()-interval '7 days' as restorable from aigc.suite_projects where id=${id}`
    if (restore && !valid.restorable)
      throw new HttpError(410, '项目已超过七天恢复期限', 'SUITE_NOT_FOUND')
    await sql`update aigc.suite_projects set deleted_at=${restore ? null : row.deleted_at ?? new Date()},updated_at=now() where id=${id}`
    if (!restore) {
      const { stopUnsubmittedOperations } = await import('./batches.js')
      const batches = await sql`select id from aigc.suite_batches where project_id=${id} and state in ('queued','running','blocked') order by id for update`
      for (const batch of batches) await stopUnsubmittedOperations(sql, String(batch.id), 'PROJECT_DELETED')
    }
    return { restored: restore }
  })
}
