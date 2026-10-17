import type { Transaction } from '../db.js'
import { HttpError } from '../errors.js'
import { actor, requireSuite, suiteTransaction, type SuiteUser } from './repository.js'

/** 先登记持久对象意图，再进行有超时的外部写入；清理隔离后不得开始新写入。 */
export function beginSuiteObjectWrite(user: SuiteUser, projectId: string, key: string) {
  const prefix = `suite-assets/${actor(user).runtimeScope}/${user.id}/${projectId}/`
  if (!key.startsWith(prefix) || key.includes('..')) throw new HttpError(400, '套图对象路径无效', 'INVALID_SOURCE')
  return suiteTransaction(user, async sql => {
    await requireSuite(sql, projectId, true, true)
    await sql`insert into aigc.suite_object_writes(object_key,user_id,scope,project_id)
      values(${key},${user.id},${actor(user).runtimeScope},${projectId})
      on conflict(object_key) do update set last_write_at=clock_timestamp()`
  })
}

/** 同步原任务不保存完整输入，须在同一预扣事务保留引用，并锁住来源项目以隔离清理。 */
export async function bindSuiteSyncInputs(sql: Transaction, input: Record<string, unknown>, syncId: string) {
  const keys = new Set<string>()
  const visit = (value: unknown) => {
    if (typeof value === 'string' && value.startsWith('suite-assets/')) keys.add(value)
    else if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object') Object.values(value).forEach(visit)
  }
  visit(input)
  for (const key of [...keys].sort()) {
    const [asset] = await sql`select a.id,a.project_id,a.user_id,a.scope from aigc.suite_assets a join aigc.suite_projects p on p.id=a.project_id
      where a.object_key=${key} and a.status='ready' and a.purged_at is null and p.deleted_at is null and p.purge_started_at is null for update of p`
    if (!asset) throw new HttpError(400, '套图输入不存在、已删除或无权访问', 'INVALID_SOURCE')
    await sql`insert into aigc.suite_sync_inputs(user_id,scope,project_id,asset_id,sync_id)
      values(${asset.user_id},${asset.scope},${asset.project_id},${asset.id},${syncId}) on conflict do nothing`
  }
}
