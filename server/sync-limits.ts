import { randomUUID } from 'node:crypto'
import { runtimeScope, withIdentity, type Transaction } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './model-settings.js'

type Bucket = 'generation' | 'detection'
type User = { id: string; email: string }

const limits: Record<Bucket, { hourly: number; concurrent: number }> = {
  generation: { hourly: 20, concurrent: 2 },
  detection: { hourly: 60, concurrent: 3 },
}

export async function withSyncLimit<T>(user: User, bucket: Bucket, action: () => Promise<T>): Promise<T> {
  const id = randomUUID()
  const scope = runtimeScope()
  await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    await acquireSyncRequest(sql, user.id, scope, bucket, id)
  })
  try {
    return await action()
  } finally {
    await withIdentity(user.id, user.email, async sql => {
      await sql`update aigc.sync_requests set completed_at=now()
        where id=${id} and user_id=${user.id} and scope=${scope}`
    }).catch(error => {
      console.error(JSON.stringify({ evt: 'sync-limit-release', userId: user.id, bucket, message: String(error) }))
    })
  }
}

export async function acquireSyncRequest(sql: Transaction, userId: string, scope: string, bucket: Bucket, id: string) {
  const limit = limits[bucket]
  await sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${bucket}`}))`
  const [usage] = await sql`select
    count(*) filter(where created_at>now()-interval '1 hour')::integer as hourly,
    count(*) filter(where completed_at is null and lease_until>now())::integer as active
    from aigc.sync_requests where user_id=${userId} and scope=${scope} and bucket=${bucket}`
  if (Number(usage.hourly) >= limit.hourly)
    throw new HttpError(429, '该类图片操作已达到每小时使用上限，请稍后重试', 'RATE_LIMIT')
  if (Number(usage.active) >= limit.concurrent)
    throw new HttpError(429, '该类图片操作正在处理中，请等待完成', 'USER_CONCURRENCY')
  await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until)
    values(${id},${userId},${scope},${bucket},now()+interval '3 minutes')`
}
