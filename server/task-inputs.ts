import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { authenticate } from './auth.js'
import { withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './model-settings.js'
import { signUpload } from './storage.js'

type User = Awaited<ReturnType<typeof authenticate>>
const schema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().min(1).max(20 * 1024 * 1024),
}).strict()

export async function handleTaskInputs(user: User, method: string, body: unknown) {
  if (method !== 'POST') throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  const input = schema.parse(body)
  await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
  })
  const objectKey = `temporary/task-inputs/${user.id}/${randomUUID()}`
  return {
    uploadUrl: await signUpload(objectKey, input.mimeType, input.size),
    objectKey,
    expiresIn: 600,
  }
}
