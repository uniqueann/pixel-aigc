import type { authenticate } from './auth.js'
import { runtimeScope, withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './model-settings.js'
import { isSafeObjectKey } from './image-jobs/service.js'
import { getObject, signRead } from './storage.js'

type User = Awaited<ReturnType<typeof authenticate>>

export function objectContentDisposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '') || 'result'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function loadOwnedObject(user: User, key: string) {
  if (key.startsWith(`generated/${user.id}/video/`)) throw new HttpError(400, '请使用视频签名地址播放或下载', 'VIDEO_DIRECT_READ_REQUIRED')
  if (!isSafeObjectKey(user.id, key)) throw new HttpError(400, '对象无效或无权访问', 'INVALID_SOURCE')
  await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
  })
  const object = await getObject(key)
  return {
    bytes: object.bytes,
    contentType: object.contentType?.startsWith('image/') ? object.contentType : 'application/octet-stream',
  }
}

export async function signOwnedObjectRead(user: User, key: string, filename?: string) {
  if (!isSafeObjectKey(user.id, key)) throw new HttpError(400, '对象无效或无权访问', 'INVALID_SOURCE')
  const retentionExpiresAt = await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
    if (!key.startsWith(`generated/${user.id}/video/`)) return undefined
    const [row] = await sql`select j.expires_at from aigc.image_jobs j join aigc.image_job_items i on i.job_id=j.id
      where j.user_id=${user.id} and j.scope=${runtimeScope()} and j.capability='text_to_video'
        and j.status='succeeded' and j.expires_at>now()
        and (i.result_object_key=${key} or i.result_metadata->>'posterKey'=${key})`
    if (!row) throw new HttpError(404, '视频已过期或无权访问', 'VIDEO_EXPIRED')
    return new Date(row.expires_at as string | Date).getTime()
  })
  const ttl = retentionExpiresAt === undefined ? 900 : Math.min(900, Math.floor((retentionExpiresAt - Date.now()) / 1000))
  if (ttl < 1) throw new HttpError(404, '视频已过期', 'VIDEO_EXPIRED')
  return filename ? signRead(key, ttl, objectContentDisposition(filename.slice(0, 180))) : signRead(key, ttl)
}
