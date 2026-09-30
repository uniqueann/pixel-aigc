import { randomUUID } from 'node:crypto'
import {
  SYNC_USER_CONCURRENCY_MESSAGE,
  USER_CONCURRENCY_RETRY_AFTER,
  hourlyRetryAfterSeconds,
  rateLimitExtra,
  rateLimitWaitMinutes,
  syncHourlyRateLimitMessage,
} from '../shared/rate-limit.js'
import { runtimeScope, withIdentity, type Transaction } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './model-settings.js'

type Bucket = 'generation' | 'detection'
type User = { id: string; email: string }

const limits: Record<Bucket, { hourly: number; concurrent: number }> = {
  generation: { hourly: 20, concurrent: 2 },
  detection: { hourly: 60, concurrent: 3 },
}

export interface SyncRequestMetrics {
  route: 'erase'
  requestId: string
  transport: 'inline' | 'object'
  inputBytes: number
  maskBytes: number
  outputBytes?: number
  stageMs: Record<string, number>
}

export async function withSyncLimit<T>(user: User, bucket: Bucket, action: () => Promise<T>, metrics?: SyncRequestMetrics): Promise<T> {
  const id = randomUUID()
  const scope = runtimeScope()
  await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    await acquireSyncRequest(sql, user.id, scope, bucket, id, metrics)
  })
  let httpStatus = 200
  let errorCode: string | null = null
  try {
    return await action()
  } catch (error) {
    httpStatus = error instanceof HttpError ? error.status : 500
    errorCode = error instanceof HttpError ? error.code ?? 'SYNC_FAILED' : 'SERVER_ERROR'
    throw error
  } finally {
    await withIdentity(user.id, user.email, async sql => {
      await sql`update aigc.sync_requests set completed_at=now(),http_status=${metrics ? httpStatus : null},
        error_code=${errorCode},input_bytes=${metrics?.inputBytes ?? null},mask_bytes=${metrics?.maskBytes ?? null},
        output_bytes=${metrics?.outputBytes ?? null},stage_ms=${sql.json(metrics?.stageMs ?? {})}
        where id=${id} and user_id=${user.id} and scope=${scope}`
    }).catch(error => {
      console.error(JSON.stringify({ evt: 'sync-limit-release', userId: user.id, bucket, message: String(error) }))
    })
  }
}

export async function acquireSyncRequest(sql: Transaction, userId: string, scope: string, bucket: Bucket, id: string, metrics?: SyncRequestMetrics) {
  const limit = limits[bucket]
  await sql`select pg_advisory_xact_lock(hashtext(${`${userId}:${scope}:${bucket}`}))`
  const [usage] = await sql`select
    count(*) filter(where created_at>now()-interval '1 hour')::integer as hourly,
    count(*) filter(where completed_at is null and lease_until>now())::integer as active,
    min(created_at) filter(where created_at>now()-interval '1 hour') as oldest
    from aigc.sync_requests where user_id=${userId} and scope=${scope} and bucket=${bucket}`
  if (Number(usage.hourly) >= limit.hourly) {
    const seconds = hourlyRetryAfterSeconds(usage.oldest as Date | string | null)
    throw new HttpError(429, syncHourlyRateLimitMessage(rateLimitWaitMinutes(seconds)), 'RATE_LIMIT', {
      extra: rateLimitExtra(seconds),
    })
  }
  if (Number(usage.active) >= limit.concurrent) {
    throw new HttpError(429, SYNC_USER_CONCURRENCY_MESSAGE, 'USER_CONCURRENCY', {
      extra: rateLimitExtra(USER_CONCURRENCY_RETRY_AFTER),
    })
  }
  await sql`insert into aigc.sync_requests(id,user_id,scope,bucket,lease_until,route,request_id,transport)
    values(${id},${userId},${scope},${bucket},now()+interval '3 minutes',${metrics?.route ?? null},${metrics?.requestId ?? null},${metrics?.transport ?? null})`
}
