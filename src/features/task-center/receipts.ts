import { z } from 'zod'
import {
  taskOriginSchema,
  taskSourceKinds,
  type TaskOrigin,
  type TaskSourceKind,
} from '@shared/task-center'
import {
  currentTaskActor,
  sameTaskActor,
  taskCenterOn,
  type TaskActor,
} from './client'
import { readWorkstationSession,saveWorkstationSession } from './workstationSession'

export const TASK_CENTER_EVENT = 'pixel-task-center'
const receiptSchema = z
  .object({
    owner: z.uuid(),
    scope: z.enum(['local', 'preview', 'production']),
    sourceKind: z.enum(taskSourceKinds),
    requestId: z.uuid(),
    origin: taskOriginSchema.nullable(),
    createdAt: z.number(),
  })
  .strict()
export type TaskReceipt = z.infer<typeof receiptSchema>
export interface TaskCenterEvent {
  type: 'start' | 'submitted' | 'refresh' | 'storage-error' | 'observed'
  receipt?: TaskReceipt
  sourceId?: string
  requestId?: string
  sourceKind?: TaskSourceKind
  active?: boolean
  viewing?: boolean
  actor?: TaskActor
}
const key = (actor: TaskActor) =>
  `pixel-task-receipts:${actor.owner}:${actor.scope}`
export function emitTaskCenter(event: TaskCenterEvent) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(new CustomEvent(TASK_CENTER_EVENT, { detail: event }))
}
export function readReceipts(actor: TaskActor): TaskReceipt[] {
  try {
    const input: unknown = JSON.parse(localStorage.getItem(key(actor)) ?? '[]')
    if (!Array.isArray(input)) return []
    return input
      .flatMap((value) => {
        const parsed = receiptSchema.safeParse(value)
        return parsed.success &&
          parsed.data.owner === actor.owner &&
          parsed.data.scope === actor.scope &&
          parsed.data.createdAt > Date.now() - 7 * 86400000 &&
          parsed.data.createdAt <= Date.now() + 1000
          ? [parsed.data]
          : []
      })
      .slice(-50)
  } catch {
    return []
  }
}
export function saveReceipt(
  kind: TaskSourceKind,
  requestId: string,
  origin?: TaskOrigin,
  persist = true,
): TaskReceipt | undefined {
  const actor = currentTaskActor()
  if (!actor || !taskCenterOn()) return
  const receipt = receiptSchema.safeParse({
    ...actor,
    sourceKind: kind,
    requestId,
    origin: origin ?? null,
    createdAt: Date.now(),
  })
  if (!receipt.success) return
  try {
    if (persist)
      localStorage.setItem(
        key(actor),
        JSON.stringify(
          [
            ...readReceipts(actor).filter(
              (r) => r.sourceKind !== kind || r.requestId !== requestId,
            ),
            receipt.data,
          ].slice(-50),
        ),
      )
  } catch {
    emitTaskCenter({ type: 'storage-error' })
  }
  if(receipt.data.origin?.entry==='workstation'&&kind!=='email_task'&&!saveWorkstationSession(actor,receipt.data.origin.tool,{task:undefined,lastRequestAt:receipt.data.createdAt}))emitTaskCenter({type:'storage-error'})
  emitTaskCenter({ type: 'start', receipt: receipt.data })
  return receipt.data
}
export function removeReceipt(
  actor: TaskActor,
  kind: TaskSourceKind,
  requestId: string,
) {
  if (!sameTaskActor(actor)) return
  try {
    localStorage.setItem(
      key(actor),
      JSON.stringify(
        readReceipts(actor).filter(
          (r) => r.sourceKind !== kind || r.requestId !== requestId,
        ),
      ),
    )
  } catch {
    /* 存储不可用时仍保留服务端查询能力。 */
  }
}
export function submittedReceipt(
  receipt: TaskReceipt | undefined,
  sourceId: string,
) {
  if (!receipt || !sameTaskActor(receipt)) return
  rememberWorkstationSubmission(receipt,sourceId)
  removeReceipt(receipt, receipt.sourceKind, receipt.requestId)
  emitTaskCenter({ type: 'submitted', receipt, sourceId })
}

/** 提交响应或全局原请求查询均写入同一任务绑定，不另存第二份待确认凭据。 */
export function rememberWorkstationSubmission(receipt:TaskReceipt,sourceId:string) {
  if(!sameTaskActor(receipt)||receipt.origin?.entry!=='workstation'||(receipt.sourceKind!=='image_job'&&receipt.sourceKind!=='sync_credit'))return
  const tool=receipt.origin.tool
  if((readWorkstationSession(receipt,tool)?.lastRequestAt??0)>receipt.createdAt)return
  if(readReceipts(receipt).some(other=>other.origin?.entry==='workstation'&&other.origin.tool===tool&&other.createdAt>receipt.createdAt))return
  if(!saveWorkstationSession(receipt,tool,{task:{sourceKind:receipt.sourceKind,sourceId}}))emitTaskCenter({type:'storage-error'})
}

/** 同步入口按实际调用工具分类；单纯本地处理不会调用该函数。 */
export function syncTaskOrigin(operation: string): TaskOrigin | undefined {
  if (operation === 'bg-remove') return { entry: 'toolbox', tool: 'bg-remove' }
  if (operation === 'outpaint')
    return typeof window !== 'undefined' &&
      window.location.pathname.startsWith('/toolbox/aspect-ratio')
      ? { entry: 'toolbox', tool: 'aspect-ratio' }
      : { entry: 'workstation', tool: 'outpaint' }
  if (operation === 'erase' || operation === 'repaint')
    return {
      entry: 'workstation',
      tool: operation === 'erase' ? 'remove' : 'repaint',
    }
}
export function defaultTaskOrigin(
  capability: string,
  params: unknown,
): TaskOrigin | undefined {
  if (capability === 'email_assist')
    return { entry: 'email', tool: 'email-assist' }
  if (
    typeof window === 'undefined' ||
    !window.location.pathname.startsWith('/image-workstation')
  )
    return
  if (capability === 'variation')
    return { entry: 'workstation', tool: 'variation' }
  if (capability === 'image_edit') {
    const routeTool = window.location.pathname.split('/')[2]
    if (['smart-edit', 'fusion', 'relight', 'retouch'].includes(routeTool))
      return {
        entry: 'workstation',
        tool: routeTool as 'smart-edit' | 'fusion' | 'relight' | 'retouch',
      }
    const p = (params ?? {}) as Record<string, unknown>
    return {
      entry: 'workstation',
      tool: p.referenceImageKey
        ? 'fusion'
        : p.relight
          ? 'relight'
          : Array.isArray(p.retouchDirections) && p.retouchDirections.length
            ? 'retouch'
            : 'smart-edit',
    }
  }
}
