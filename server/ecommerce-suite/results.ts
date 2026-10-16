import { randomUUID } from 'node:crypto'
import { suiteBatchSchema, suiteOperationSchema, suiteQuoteSchema, suiteVersionSchema, type SuiteAssetRef, type SuiteSlotVersion } from '../../shared/ecommerce-suite.js'
import { HttpError } from '../errors.js'
import { inspectSuiteImage, suiteObjectKey, suiteStorage } from './assets.js'
import { actor, fingerprint, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'

/** 结果登记只读取原任务和复制图片，任何恢复路径都不调用供应商或创建收费任务。 */
export async function registerSuiteResults(user: SuiteUser, projectId: string, batchId: string, storage = suiteStorage) {
  const input = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    const [row] = await sql`select b.snapshot,q.snapshot as quote from aigc.suite_batches b join aigc.suite_quotes q on q.id=b.quote_id and q.project_id=b.project_id
      where b.id=${batchId} and b.project_id=${projectId}`
    if (!row) throw new HttpError(404, '原批次不存在或无权访问', 'SUITE_NOT_FOUND')
    const batch = suiteBatchSchema.parse(row.snapshot), quote = suiteQuoteSchema.parse(row.quote)
    const [op] = await sql`select snapshot from aigc.suite_operations where batch_id=${batchId} and project_id=${projectId}`
    const operation = suiteOperationSchema.parse(op.snapshot)
    const existing = (await sql`select application_key from aigc.suite_versions where project_id=${projectId} and slot_id=${operation.slotId}`).map(row => String(row.application_key))
    const job = operation.task ? (await sql`select * from aigc.image_jobs where id=${operation.task.sourceId} and request_id=${operation.requestId}`)[0] : null
    const results = job ? await sql`select * from aigc.image_job_items where job_id=${job.id} and status='succeeded' and result_object_key is not null order by ordinal` : []
    return { batch, quote, operation, existing, job, results }
  })
  const item = input.quote.items[0]
  const prepared: { ordinal: number; asset: SuiteAssetRef; application: string; generated: boolean }[] = []
  if (item.mode === 'reuse') {
    const asset = await suiteTransaction(user, sql => readyAsset(sql, projectId, item.sourceAssetId))
    prepared.push({ ordinal: 0, asset, application: `reuse:${input.operation.id}`, generated: false })
  } else {
    for (const result of input.results) {
      const application = `image_job:${input.operation.task!.sourceId}:${result.ordinal}`
      if (input.existing.includes(application)) continue
      const bytes = (await storage.read(String(result.result_object_key))).bytes
      const inspected = await inspectSuiteImage(bytes, String(result.result_mime_type))
      const digest = fingerprint({ projectId, application })
      const assetId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
      const objectKey = suiteObjectKey(user, projectId, assetId, inspected.checksum, inspected.mimeType)
      await storage.put(objectKey, bytes, inspected.mimeType)
      prepared.push({ ordinal: Number(result.ordinal), asset: { assetId, projectId, actor: actor(user), objectKey, ...inspected }, application, generated: true })
    }
  }
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const [op] = await sql`select snapshot from aigc.suite_operations where batch_id=${batchId} and project_id=${projectId} for update`
    const operation = suiteOperationSchema.parse(op.snapshot)
    const [slot] = await sql`select * from aigc.suite_slots where project_id=${projectId} and id=${operation.slotId} for update`
    const created: SuiteSlotVersion[] = []
    for (const ready of prepared) {
      const [old] = await sql`select snapshot from aigc.suite_versions where project_id=${projectId} and slot_id=${operation.slotId} and application_key=${ready.application}`
      if (old) continue
      const asset = ready.asset
      if (ready.generated) await sql`insert into aigc.suite_assets(id,user_id,scope,project_id,request_fingerprint,upload_id,temp_key,object_key,mime_type,bytes,width,height,checksum,status)
        values(${asset.assetId},${user.id},${actor(user).runtimeScope},${projectId},${fingerprint(asset)},${randomUUID()},'',${asset.objectKey},${asset.mimeType},${asset.bytes},${asset.size.width},${asset.size.height},${asset.checksum},'ready')`
      const [sequence] = await sql`select coalesce(max(version_number),0)+1 as value from aigc.suite_versions where project_id=${projectId} and slot_id=${operation.slotId}`
      const config = input.batch.configSnapshot
      const version = suiteVersionSchema.parse({ id: randomUUID(), projectId, slotId: operation.slotId, versionNumber: Number(sequence.value),
        parentVersionId: slot.active_version_id, assetId: asset.assetId, source: ready.generated ? 'generated' : 'reuse',
        ...(item.mode === 'image_edit' ? { sourceTask: { sourceKind: 'image_job', sourceId: operation.task!.sourceId, ordinal: ready.ordinal },
          sourceRequestId: operation.requestId, modelProfileId: item.modelProfileId, resolution: item.resolution, promptSnapshot: item.promptSnapshot } : {}),
        composition: { renderSize: asset.size, layersSnapshot: [], factsSnapshot: config.facts.filter(fact => fact.confirmed),
          copyLanguage: config.copyLanguage, unitSystem: config.unitSystem, templateVersion: config.style.templateVersion, rendererVersion: 'suite-base-v1' }, createdAt: new Date().toISOString() })
      await sql`insert into aigc.suite_versions(id,user_id,scope,project_id,slot_id,asset_id,parent_version_id,version_number,application_key,snapshot)
        values(${version.id},${user.id},${actor(user).runtimeScope},${projectId},${operation.slotId},${asset.assetId},${version.parentVersionId},${version.versionNumber},${ready.application},${sql.json(version as never)})`
      created.push(version)
    }
    const all = (await sql`select id from aigc.suite_versions where project_id=${projectId} and slot_id=${operation.slotId}
      and application_key like ${item.mode === 'reuse' ? `reuse:${operation.id}` : `image_job:${operation.task!.sourceId}:%`} order by version_number`).map(row => String(row.id))
    // 旧成品和编辑草稿存在时只保存候选，任何晚到结果都不能越过当前指针修订。
    if (all.length === 1 && item.count === 1 && !slot.active_version_id && slot.head_revision === operation.expectedHeadRevision && slot.draft_revision === 0)
      await sql`update aigc.suite_slots set active_version_id=${all[0]},head_revision=head_revision+1 where id=${operation.slotId} and project_id=${projectId}`
    const terminal = operation.terminalState ?? (item.mode === 'reuse' ? 'succeeded'
      : input.job && !['queued', 'processing'].includes(input.job.status) ? input.job.status
        : !input.job && operation.task ? 'expired' : null)
    const updated = suiteOperationSchema.parse({ ...operation, phase: item.mode === 'reuse' && terminal ? 'bound' : operation.phase,
      terminalState: terminal, appliedVersionIds: all, updatedAt: new Date().toISOString() })
    const state = terminal ? all.length === item.count ? 'succeeded' : all.length ? 'partial' : 'failed' : 'running'
    const batch = suiteBatchSchema.parse({ ...input.batch, state, completedAt: terminal ? input.batch.completedAt ?? new Date().toISOString() : null })
    await sql`update aigc.suite_operations set snapshot=${sql.json(updated as never)} where id=${operation.id}`
    await sql`update aigc.suite_batches set state=${state},snapshot=${sql.json(batch as never)} where id=${batchId} and project_id=${projectId}`
    if (created.length) await sql`update aigc.suite_projects set updated_at=now() where id=${projectId}`
    return { batch, operation: updated, createdVersionIds: created.map(version => version.id) }
  })
}
