import type { authenticate } from './auth.js'
import { withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './model-settings.js'
import { isSafeObjectKey } from './image-jobs/service.js'
import { getObject } from './storage.js'

type User = Awaited<ReturnType<typeof authenticate>>

export function objectContentDisposition(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7E]+/g, '_').replace(/["\\]/g, '') || 'result'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`
}

export async function loadOwnedObject(user: User, key: string) {
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
