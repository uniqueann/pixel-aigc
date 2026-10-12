import { z } from 'zod'
import type { TaskScope } from '@shared/task-center'
import type { TaskActor } from '@/features/task-center/client'

const uuid = z.uuid()
const liveSchema = z.object({
  v: z.literal(1),
  owner: uuid,
  scope: z.enum(['local', 'preview', 'production']),
  tool: z.string().min(1).max(40),
  sourceKind: z.enum(['image_job', 'sync_credit']),
  requestId: uuid,
  sourceId: uuid.optional(),
  createdAt: z.number().int().positive(),
}).strict()
export type WorkstationLiveSession = z.infer<typeof liveSchema>

const inputSchema = z.object({
  v: z.literal(1),
  owner: uuid,
  scope: z.enum(['local', 'preview', 'production']),
  tool: z.string().min(1).max(40),
  name: z.string().min(1).max(200),
  objectKey: z.string().min(1).max(500),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  mimeType: z.string().min(1).max(80),
  createdAt: z.number().int().positive(),
}).strict()
export type WorkstationInputDraft = z.infer<typeof inputSchema>

const liveKey = (actor: TaskActor, tool: string) => `pixel-workstation-live:${actor.owner}:${actor.scope}:${tool}`
const inputKey = (actor: TaskActor, tool: string) => `pixel-workstation-input:${actor.owner}:${actor.scope}:${tool}`

function readJson<T>(key: string, schema: z.ZodType<T>, actor: TaskActor, tool: string): T | undefined {
  try {
    const parsed = schema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'))
    if (!parsed.success) return
    const value = parsed.data as T & { owner: string; scope: TaskScope; tool: string; createdAt: number }
    if (value.owner !== actor.owner || value.scope !== actor.scope || value.tool !== tool) return
    if (value.createdAt > Date.now() + 60_000 || value.createdAt < Date.now() - 7 * 86400000) return
    return parsed.data
  } catch {
    return
  }
}

export function readLiveSession(actor: TaskActor, tool: string) {
  return readJson(liveKey(actor, tool), liveSchema, actor, tool)
}
export function writeLiveSession(session: WorkstationLiveSession) {
  const parsed = liveSchema.safeParse(session)
  if (!parsed.success) return
  try { localStorage.setItem(liveKey(parsed.data, parsed.data.tool), JSON.stringify(parsed.data)) } catch { /* 存储不可用时仍保留当次页面状态。 */ }
}
export function clearLiveSession(actor: TaskActor, tool: string) {
  try { localStorage.removeItem(liveKey(actor, tool)) } catch { /* 忽略存储失败。 */ }
}

export function readInputDraft(actor: TaskActor, tool: string) {
  return readJson(inputKey(actor, tool), inputSchema, actor, tool)
}
export function writeInputDraft(draft: WorkstationInputDraft) {
  const parsed = inputSchema.safeParse(draft)
  if (!parsed.success) return false
  try {
    localStorage.setItem(inputKey(parsed.data, parsed.data.tool), JSON.stringify(parsed.data))
    return true
  } catch {
    return false
  }
}
export function clearInputDraft(actor: TaskActor, tool: string) {
  try { localStorage.removeItem(inputKey(actor, tool)) } catch { /* 忽略存储失败。 */ }
}
