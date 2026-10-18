import { randomUUID } from 'node:crypto'
import { suiteBatchSchema, suiteOperationSchema, suiteQuoteSchema, suiteVersionSchema, type SuiteAssetRef, type SuiteSlotVersion } from '../../shared/ecommerce-suite.js'
import { HttpError } from '../errors.js'
import { inspectSuiteImage, rememberSuiteThumbnail, suiteObjectKey, suiteStorage } from './assets.js'
import { refreshSuiteBatch } from './batches.js'
import { actor, fingerprint, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'
import { SUITE_RENDERER_VERSION } from '../../shared/ecommerce-suite-annotations.js'
import { beginSuiteObjectWrite } from './object-writes.js'

/** 结果登记只读取原任务和复制图片，任何恢复路径都不调用供应商或创建收费任务。 */
export async function registerSuiteOperationResults(user: SuiteUser, projectId: string, batchId: string, operationId: string, storage = suiteStorage, leaseToken?: string) {
  const input = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, false, true)
    const [row] = await sql`select b.snapshot,q.snapshot as quote from aigc.suite_batches b join aigc.suite_quotes q on q.id=b.quote_id and q.project_id=b.project_id
      where b.id=${batchId} and b.project_id=${projectId}`
    if (!row) throw new HttpError(404, '原批次不存在或无权访问', 'SUITE_NOT_FOUND')
    const batch = suiteBatchSchema.parse(row.snapshot), quote = suiteQuoteSchema.parse(row.quote)
    const [op] = await sql`select *,lease_until>clock_timestamp() as lease_valid from aigc.suite_operations where id=${operationId} and batch_id=${batchId} and project_id=${projectId}`
    if (!op || (leaseToken ? op.lease_token !== leaseToken || !op.lease_valid : op.lease_valid)) return null
    const operation = suiteOperationSchema.parse(op.snapshot)
    if (operation.phase === 'stopped' || !operation.task && operation.phase !== 'bound') return null
    const existing = (await sql`select application_key from aigc.suite_versions where project_id=${projectId} and slot_id=${operation.slotId}`).map(row => String(row.application_key))
    const job = operation.task ? (await sql`select * from aigc.image_jobs where id=${operation.task.sourceId} and request_id=${operation.requestId}`)[0] : null
    const results = job ? await sql`select * from aigc.image_job_items where job_id=${job.id} and status='succeeded' and result_object_key is not null order by ordinal` : []
    return { batch, quote, operation, existing, job, results }
  })
  if (!input) return null
  const item = input.quote.items.find(item => item.operationId === operationId)!
  const prepared: { ordinal: number; asset: SuiteAssetRef; application: string; generated: boolean; sourceBytes?: Uint8Array }[] = []
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
      await beginSuiteObjectWrite(user, projectId, objectKey)
      await storage.put(objectKey, bytes, inspected.mimeType, AbortSignal.timeout(20_000))
      prepared.push({ ordinal: Number(result.ordinal), asset: { assetId, projectId, actor: actor(user), objectKey, ...inspected }, application, generated: true, sourceBytes: bytes })
    }
  }
  const saved = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true, true)
    await sql`select id from aigc.suite_batches where id=${batchId} and project_id=${projectId} for update`
    const [op] = await sql`select *,lease_until>clock_timestamp() as lease_valid from aigc.suite_operations where id=${operationId} and batch_id=${batchId} and project_id=${projectId} for update`
    if (!op || (leaseToken ? op.lease_token !== leaseToken || !op.lease_valid : op.lease_valid)) return null
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
        composition: { renderSize: asset.size,
          layersSnapshot: item.slotKind === 'size' && !config.slots.find(slot => slot.id === operation.slotId)!.referenceAssetIds.length
            ? config.facts.filter(fact => fact.confirmed && ['dimension','capacity'].includes(fact.kind)).slice(0,3).map((fact, index) => ({
              id: randomUUID(), type: 'dimension', factId: fact.id, start: { x: .15, y: .72 + index * .08 }, end: { x: .85, y: .72 + index * .08 }, labelPosition: { x: .5, y: .72 + index * .08 },
              color: '#111827', strokeWidth: Math.min(100, asset.size.width * .002), fontSize: Math.min(1000, asset.size.width * .035), zIndex: index })) : [],
          factsSnapshot: config.facts.filter(fact => fact.confirmed),
          copyLanguage: config.copyLanguage, unitSystem: config.unitSystem, templateVersion: config.style.templateVersion, rendererVersion: SUITE_RENDERER_VERSION }, createdAt: new Date().toISOString() })
      await sql`insert into aigc.suite_versions(id,user_id,scope,project_id,slot_id,asset_id,parent_version_id,version_number,application_key,snapshot)
        values(${version.id},${user.id},${actor(user).runtimeScope},${projectId},${operation.slotId},${asset.assetId},${version.parentVersionId},${version.versionNumber},${ready.application},${sql.json(version as never)})`
      created.push(version)
    }
    const all = (await sql`select id from aigc.suite_versions where project_id=${projectId} and slot_id=${operation.slotId}
      and application_key like ${item.mode === 'reuse' ? `reuse:${operation.id}` : `image_job:${operation.task!.sourceId}:%`} order by version_number`).map(row => String(row.id))
    // 后台无法观察本机未同步草稿；统一只保存候选，当前指针由用户显式选择。
    const terminal = operation.terminalState ?? (item.mode === 'reuse' ? 'succeeded'
      : input.job && !['queued', 'processing'].includes(input.job.status) ? input.job.status
        : !input.job && operation.task ? 'expired' : null)
    const updated = suiteOperationSchema.parse({ ...operation, phase: item.mode === 'reuse' && terminal ? 'bound' : operation.phase,
      terminalState: terminal, appliedVersionIds: all, updatedAt: new Date().toISOString() })
    await sql`update aigc.suite_operations set snapshot=${sql.json(updated as never)} where id=${operation.id}`
    const batch = await refreshSuiteBatch(sql, batchId)
    if (created.length) await sql`update aigc.suite_projects set updated_at=now() where id=${projectId}`
    return { batch, operation: updated, createdVersionIds: created.map(version => version.id) }
  })
  if (saved) await Promise.all(prepared.map(item => item.sourceBytes ? rememberSuiteThumbnail(user, projectId, item.asset, storage, item.sourceBytes) : null))
  return saved
}

/** 页面只能登记已有结果，不能领取等待项或提交供应商。 */
export async function registerSuiteResults(user: SuiteUser, projectId: string, batchId: string, storage = suiteStorage) {
  const ids = await suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId)
    const [batch] = await sql`select id from aigc.suite_batches where id=${batchId} and project_id=${projectId}`
    if (!batch) throw new HttpError(404, '原批次不存在或无权访问', 'SUITE_NOT_FOUND')
    return (await sql`select id from aigc.suite_operations where batch_id=${batchId} order by id`).map(row => String(row.id))
  })
  const results = []
  for (const id of ids) results.push(await registerSuiteOperationResults(user, projectId, batchId, id, storage))
  return { operations: results.filter(Boolean) }
}
