import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { authenticate } from './auth.js'
import { withIdentity } from './db.js'
import { HttpError } from './errors.js'
import { requireActive } from './members.js'
import { putObject, signUpload } from './storage.js'

type User = Awaited<ReturnType<typeof authenticate>>
const schema = z.object({
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  size: z.number().int().min(1).max(20 * 1024 * 1024),
}).strict()

const fallbackSchema = z.object({
  objectKey: z.string().min(1).max(512),
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  dataBase64: z.string().min(1),
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

export async function handleTaskInputFallback(user: User, method: string, body: unknown) {
  if (method !== 'POST') throw new HttpError(404, '接口不存在', 'NOT_FOUND')
  const input = fallbackSchema.parse(body)
  if (!input.objectKey.startsWith(`temporary/task-inputs/${user.id}/`)) {
    throw new HttpError(403, '无权操作该对象路径', 'FORBIDDEN')
  }
  await withIdentity(user.id, user.email, async sql => {
    await requireActive(sql, user.id)
  })
  const bytes = Buffer.from(input.dataBase64, 'base64')
  if (!bytes.length || bytes.length > 20 * 1024 * 1024) throw new HttpError(413, '图片大小不能超过 20 MB')
  await putObject(input.objectKey, bytes, input.mimeType)
  return { objectKey: input.objectKey, ok: true }
}
