import { suiteBridgeSchema } from '../../shared/ecommerce-suite.js'
import type { TaskOrigin } from '../../shared/task-center.js'
import type { Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { ecommerceSuiteEnabled } from './config.js'

/** 在原任务创建事务里核验关联；没有桥接的既有工具路径不读套图表。 */
export async function validateSuiteBridgeTask(sql: Transaction, origin: TaskOrigin | undefined, sourceKey: unknown, requestId: string, kind: 'image_job' | 'sync_credit') {
  if (origin?.entry !== 'workstation' || !origin.suiteBridgeId) return
  if (!ecommerceSuiteEnabled()) throw new HttpError(503, '电商套图暂未开放', 'SUITE_DISABLED')
  const [row] = await sql`select b.snapshot,a.object_key,p.deleted_at,b.expires_at>clock_timestamp() as valid
    from aigc.suite_bridges b join aigc.suite_assets a on a.project_id=b.project_id and a.id=b.source_asset_id and a.status='ready'
    join aigc.suite_projects p on p.id=b.project_id where b.id=${origin.suiteBridgeId}`
  if (!row || row.deleted_at) throw new HttpError(404, '桥接来源不可用，请先恢复项目或重新进入工作站', 'SUITE_NOT_FOUND')
  const bridge = suiteBridgeSchema.parse(row.snapshot)
  if (!row.valid) throw new HttpError(410, '工作站会话已过期，请回套图重新创建会话', 'SUITE_BRIDGE_EXPIRED')
  if (bridge.tool !== origin.tool || row.object_key !== sourceKey || (bridge.tool === 'repaint') !== (kind === 'sync_credit'))
    throw new HttpError(409, '当前图片或工具与桥接来源不一致，请重新创建会话', 'SUITE_RESULT_CONFLICT')
  const [existing] = kind === 'image_job' ? await sql`select origin from aigc.image_jobs where request_id=${requestId}`
    : await sql`select origin from aigc.sync_credit_jobs where id=${requestId}`
  if (existing && existing.origin?.suiteBridgeId !== bridge.id) throw new HttpError(409, '原请求已关联其他来源', 'SUITE_REQUEST_CONFLICT')
}
