import { randomUUID } from 'node:crypto'
import { runtimeScope } from '../db.js'
import { deleteObject } from '../storage.js'
import { withImageMaintenance } from '../image-jobs/maintenance.js'

/** 单独的维护入口、开关和固定预算；只删除持久对象，不派发任务或改写账本。 */
export async function cleanupSuiteAssets(storage = { delete: deleteObject }, signal?: AbortSignal, runId = randomUUID()) {
  const report = { runId, scope: runtimeScope(), projectsStarted: 0, objectsDeleted: 0, failures: 0, disabled: false }
  if (process.env.ECOMMERCE_SUITE_CLEANUP_ENABLED !== 'true') return { ...report, disabled: true }
  const budget = AbortSignal.any([AbortSignal.timeout(45_000), ...(signal ? [signal] : [])])
  report.projectsStarted = await withImageMaintenance(async sql => Number((await sql`select aigc.start_expired_suite_cleanup(${report.scope}) as count`)[0].count))
  for (let index = 0; index < 8 && !budget.aborted; index++) {
    const [claim] = await withImageMaintenance(sql => sql`select * from aigc.claim_suite_object_cleanup(${report.scope})`)
    if (!claim) break
    try {
      await storage.delete(String(claim.object_key), AbortSignal.any([budget, AbortSignal.timeout(10_000)]))
      const done = await withImageMaintenance(async sql => (await sql`select aigc.finish_suite_object_cleanup(${claim.object_key},${claim.lease_token}::uuid,true) as done`)[0].done)
      if (done) report.objectsDeleted++
    } catch {
      report.failures++
      await withImageMaintenance(sql => sql`select aigc.finish_suite_object_cleanup(${claim.object_key},${claim.lease_token}::uuid,false)`)
    }
  }
  // 仅在所有持久对象已清理后标记完成；原任务仍引用的对象继续保留。
  await withImageMaintenance(sql => sql`select aigc.start_expired_suite_cleanup(${report.scope},false)`)
  return report
}
