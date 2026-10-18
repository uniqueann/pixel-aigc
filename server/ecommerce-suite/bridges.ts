import { randomUUID } from 'node:crypto'
import { suiteBridgeResultRequestSchema, suiteBridgeSchema, suiteCreateBridgeRequestSchema, suiteVersionSchema, SUITE_LIMITS, type SuiteBridge, type SuiteTaskResult } from '../../shared/ecommerce-suite.js'
import { scaleSuiteComposition, suiteMainLocked } from '../../shared/ecommerce-suite-annotations.js'
import { HttpError } from '../errors.js'
import { inspectSuiteImage, rememberSuiteThumbnail, suiteObjectKey, suiteStorage } from './assets.js'
import { actor, assertRevision, fingerprint, readSuite, readyAsset, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'
import { beginSuiteObjectWrite } from './object-writes.js'

export function createSuiteBridge(user: SuiteUser, projectId: string, body: unknown) {
  const request = suiteCreateBridgeRequestSchema.parse(body)
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true)
    const project = await readSuite(sql, projectId)
    const head = project.slotHeads.find(head => head.slotId === request.slotId)
    if (!head) throw new HttpError(404, '槽位不存在', 'SUITE_NOT_FOUND')
    assertRevision(head.headRevision, request.expectedHeadRevision, 'SUITE_HEAD_CONFLICT')
    if (head.activeVersionId !== request.sourceVersionId) throw new HttpError(409, '当前来源版本已改变，请重新打开工作站', 'SUITE_HEAD_CONFLICT')
    const [row] = await sql`select snapshot from aigc.suite_versions where project_id=${projectId} and slot_id=${request.slotId} and id=${request.sourceVersionId}`
    if (!row) throw new HttpError(404, '来源版本不存在', 'SUITE_RESULT_CONFLICT')
    const version = suiteVersionSchema.parse(row.snapshot)
    const slot = project.config.slots.find(slot => slot.id === request.slotId)!
    if (request.inputMode === 'composite' && suiteMainLocked(project.config, slot) && version.composition.layersSnapshot.length)
      throw new HttpError(409, 'Amazon 主图禁止烘焙叠加图层', 'SUITE_MAIN_LOCKED')
    if (request.inputMode === 'composite' && !request.compositeAssetId) throw new HttpError(400, '请先保存本次合成图', 'SUITE_ASSET_UNAVAILABLE')
    if (request.inputMode === 'base' && request.compositeAssetId) throw new HttpError(400, '底图模式不能指定合成图', 'INVALID_REQUEST')
    const asset = await readyAsset(sql, projectId, request.inputMode === 'base' ? version.assetId : request.compositeAssetId!)
    if (request.inputMode === 'composite' && (asset.size.width !== version.composition.renderSize.width || asset.size.height !== version.composition.renderSize.height))
      throw new HttpError(409, '合成图尺寸与来源快照不一致', 'SUITE_RESULT_CONFLICT')
    const createdAt = new Date().toISOString()
    const bridge = suiteBridgeSchema.parse({ id: randomUUID(), actor: actor(user), projectId, slotId: request.slotId,
      sourceVersionId: version.id, sourceAssetId: asset.assetId, sourceHeadRevision: head.headRevision,
      tool: request.tool, inputMode: request.inputMode, createdAt, expiresAt: new Date(Date.parse(createdAt) + SUITE_LIMITS.bridgeTtlMs).toISOString() })
    await sql`insert into aigc.suite_bridges(id,user_id,scope,project_id,slot_id,source_version_id,source_asset_id,snapshot,created_at,expires_at)
      values(${bridge.id},${user.id},${actor(user).runtimeScope},${projectId},${bridge.slotId},${version.id},${asset.assetId},${sql.json(bridge as never)},${createdAt},${bridge.expiresAt})`
    return bridge
  })
}
export function readSuiteBridge(user: SuiteUser, bridgeId: string) {
  return suiteTransaction(user, async sql => {
    const [row] = await sql`select snapshot,expires_at>clock_timestamp() as valid from aigc.suite_bridges where id=${bridgeId}`
    if (!row) throw new HttpError(404, '工作站会话不存在或无权访问', 'SUITE_NOT_FOUND')
    const bridge = suiteBridgeSchema.parse(row.snapshot)
    await requireSuite(sql, bridge.projectId)
    if (!row.valid) throw new HttpError(410, '工作站会话已过期，请回到项目重新创建', 'SUITE_BRIDGE_EXPIRED')
    const asset = await readyAsset(sql, bridge.projectId, bridge.sourceAssetId)
    const [rowVersion] = await sql`select snapshot from aigc.suite_versions where project_id=${bridge.projectId} and slot_id=${bridge.slotId} and id=${bridge.sourceVersionId}`
    const returns = await sql`select source_kind,source_id,ordinal,version_id from aigc.suite_bridge_returns where bridge_id=${bridge.id}`
    const imageResults = await sql`select j.id,i.ordinal from aigc.image_jobs j join aigc.image_job_items i on i.job_id=j.id
      where j.origin ? 'suiteBridgeId' and j.origin->>'suiteBridgeId'=${bridge.id} and j.origin->>'entry'='workstation' and j.origin->>'tool'=${bridge.tool}
      and i.status='succeeded' and i.result_object_key is not null order by j.created_at desc,i.ordinal limit 100`
    const syncResults = await sql`select id from aigc.sync_credit_jobs where origin ? 'suiteBridgeId' and origin->>'suiteBridgeId'=${bridge.id}
      and origin->>'entry'='workstation' and origin->>'tool'=${bridge.tool} and operation='repaint' and state='settled' and result->>'objectKey' is not null order by created_at desc limit 100`
    return { bridge, asset, version: suiteVersionSchema.parse(rowVersion.snapshot), returns: returns.map(row => ({ sourceKind: row.source_kind, sourceId: row.source_id, ordinal: row.ordinal, versionId: row.version_id })),
      availableResults: [...imageResults.map(row => ({ sourceKind: 'image_job' as const, sourceId: String(row.id), ordinal: Number(row.ordinal) })),
        ...syncResults.map(row => ({ sourceKind: 'sync_credit' as const, sourceId: String(row.id), ordinal: 0 }))] }
  })
}
async function bridgeResult(user: SuiteUser, bridge: SuiteBridge, result: SuiteTaskResult) {
  return suiteTransaction(user, async sql => {
    if (result.sourceKind === 'image_job') {
      const [row] = await sql`select j.request_id,j.origin,j.params,j.model_profile_id,i.result_object_key as object_key,i.result_mime_type as mime_type
        from aigc.image_jobs j join aigc.image_job_items i on i.job_id=j.id
        where j.id=${result.sourceId} and i.ordinal=${result.ordinal} and i.status='succeeded' and i.result_object_key is not null`
      if (!row || row.origin?.entry !== 'workstation' || row.origin.tool !== bridge.tool || row.origin.suiteBridgeId !== bridge.id)
        throw new HttpError(409, '请选择本会话原工具的成功结果', 'SUITE_RESULT_CONFLICT')
      return { ...row, sourceRequestId: String(row.request_id), modelProfileId: String(row.model_profile_id) }
    }
    const [row] = await sql`select id,origin,result,operation from aigc.sync_credit_jobs where id=${result.sourceId} and state='settled'`
    if (result.ordinal !== 0 || !row || row.operation !== 'repaint' || bridge.tool !== 'repaint' || row.origin?.entry !== 'workstation' || row.origin.suiteBridgeId !== bridge.id || row.origin.tool !== bridge.tool || !row.result?.objectKey)
      throw new HttpError(409, '请选择本会话已经结算的重绘结果', 'SUITE_RESULT_CONFLICT')
    return { object_key: row.result.objectKey, mime_type: row.result.mimeType, sourceRequestId: String(row.id) }
  })
}
/** 显式回填只复制已有成功结果，永不调用供应商或账本。 */
export async function returnSuiteBridge(user: SuiteUser, bridgeId: string, body: unknown, storage = suiteStorage) {
  const request = suiteBridgeResultRequestSchema.parse(body)
  const { bridge, version: source } = await readSuiteBridge(user, bridgeId)
  const findSaved = () => suiteTransaction(user, async sql => {
    const [byRequest] = await sql`select * from aigc.suite_bridge_returns where request_id=${request.requestId}`
    const [old] = byRequest ? [byRequest] : await sql`select * from aigc.suite_bridge_returns where bridge_id=${bridgeId} and source_kind=${request.result.sourceKind} and source_id=${request.result.sourceId} and ordinal=${request.result.ordinal}`
    if (!old) return null
    if (old.bridge_id !== bridgeId || old.source_kind !== request.result.sourceKind || old.source_id !== request.result.sourceId || old.ordinal !== request.result.ordinal)
      throw new HttpError(409, '回填编号已用于其他结果', 'SUITE_REQUEST_CONFLICT')
    const [row] = await sql`select snapshot from aigc.suite_versions where id=${old.version_id} and project_id=${bridge.projectId}`
    return suiteVersionSchema.parse(row.snapshot)
  })
  const saved = await findSaved()
  if (saved) return { version: saved, candidateOnly: true, sourceChanged: true }
  const result = await bridgeResult(user, bridge, request.result)
  const bytes = (await storage.read(String(result.object_key))).bytes
  const inspected = await inspectSuiteImage(bytes, String(result.mime_type))
  const application = `bridge:${bridge.id}:${request.result.sourceKind}:${request.result.sourceId}:${request.result.ordinal}`
  const digest = fingerprint({ projectId: bridge.projectId, application })
  const assetId = `${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`
  const objectKey = suiteObjectKey(user, bridge.projectId, assetId, inspected.checksum, inspected.mimeType)
  await beginSuiteObjectWrite(user, bridge.projectId, objectKey)
  await storage.put(objectKey, bytes, inspected.mimeType, AbortSignal.timeout(20_000))
  const returned = await suiteTransaction(user, async sql => {
    await requireSuite(sql, bridge.projectId, true)
    const [lease] = await sql`select expires_at>clock_timestamp() as valid from aigc.suite_bridges where id=${bridge.id}`
    if (!lease?.valid) throw new HttpError(410, '会话已过期，已有工作站结果仍可独立下载', 'SUITE_BRIDGE_EXPIRED')
    const [slot] = await sql`select * from aigc.suite_slots where project_id=${bridge.projectId} and id=${bridge.slotId} for update`
    const [conflict] = await sql`select * from aigc.suite_bridge_returns where request_id=${request.requestId}`
    if (conflict && (conflict.bridge_id !== bridgeId || conflict.source_kind !== request.result.sourceKind || conflict.source_id !== request.result.sourceId || conflict.ordinal !== request.result.ordinal))
      throw new HttpError(409, '回填编号已用于其他结果', 'SUITE_REQUEST_CONFLICT')
    const [old] = await sql`select v.snapshot from aigc.suite_bridge_returns r join aigc.suite_versions v on v.id=r.version_id
      where r.bridge_id=${bridge.id} and r.source_kind=${request.result.sourceKind} and r.source_id=${request.result.sourceId} and r.ordinal=${request.result.ordinal}`
    if (old) return { version: suiteVersionSchema.parse(old.snapshot), candidateOnly: true, sourceChanged: true }
    const [sequence] = await sql`select coalesce(max(version_number),0)+1 as value from aigc.suite_versions where project_id=${bridge.projectId} and slot_id=${bridge.slotId}`
    const composition = scaleSuiteComposition(source.composition, inspected.size)
    if (bridge.inputMode === 'composite') composition.layersSnapshot = []
    const version = suiteVersionSchema.parse({ id: randomUUID(), projectId: bridge.projectId, slotId: bridge.slotId, versionNumber: Number(sequence.value),
      parentVersionId: source.id, assetId, source: 'workstation_return', sourceTask: request.result, sourceRequestId: result.sourceRequestId,
      sourceTool: bridge.tool, composition, createdAt: new Date().toISOString() })
    await sql`insert into aigc.suite_assets(id,user_id,scope,project_id,request_fingerprint,upload_id,temp_key,object_key,mime_type,bytes,width,height,checksum,status)
      values(${assetId},${user.id},${actor(user).runtimeScope},${bridge.projectId},${fingerprint(inspected)},${randomUUID()},'',${objectKey},${inspected.mimeType},${inspected.bytes},${inspected.size.width},${inspected.size.height},${inspected.checksum},'ready') on conflict(id) do nothing`
    await sql`insert into aigc.suite_versions(id,user_id,scope,project_id,slot_id,asset_id,parent_version_id,version_number,application_key,snapshot)
      values(${version.id},${user.id},${actor(user).runtimeScope},${bridge.projectId},${bridge.slotId},${assetId},${source.id},${version.versionNumber},${application},${sql.json(version as never)})`
    await sql`insert into aigc.suite_bridge_returns(id,user_id,scope,project_id,slot_id,bridge_id,source_kind,source_id,ordinal,request_id,version_id)
      values(${randomUUID()},${user.id},${actor(user).runtimeScope},${bridge.projectId},${bridge.slotId},${bridge.id},${request.result.sourceKind},${request.result.sourceId},${request.result.ordinal},${request.requestId},${version.id})`
    await sql`update aigc.suite_projects set updated_at=now() where id=${bridge.projectId}`
    return { version, candidateOnly: true, sourceChanged: slot.active_version_id !== source.id || slot.head_revision !== bridge.sourceHeadRevision,
      sizeChanged: source.composition.renderSize.width !== inspected.size.width || source.composition.renderSize.height !== inspected.size.height }
  })
  if (returned.version.assetId === assetId) await rememberSuiteThumbnail(user, bridge.projectId, { assetId, checksum: inspected.checksum, objectKey }, storage, bytes)
  return returned
}
