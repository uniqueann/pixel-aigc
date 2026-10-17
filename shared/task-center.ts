import { z } from 'zod'

export const taskSourceKinds = [
  'image_job',
  'sync_credit',
  'email_task',
  'suite_batch',
] as const
export type TaskSourceKind = (typeof taskSourceKinds)[number]
export const taskTools = [
  'smart-edit',
  'relight',
  'fusion',
  'retouch',
  'variation',
  'remove',
  'repaint',
  'outpaint',
  'bg-remove',
  'aspect-ratio',
  'text-to-image',
  'text-to-video',
  'image-to-video',
  'email-assist',
  'ecommerce-suite',
] as const
export type TaskTool = (typeof taskTools)[number]
export type TaskScope = 'local' | 'preview' | 'production'
export const taskToolLabels: Record<TaskTool, string> = {
  'smart-edit': '智能编辑',
  relight: '重新打光',
  fusion: '融合',
  retouch: '精修',
  variation: '裂变',
  remove: '消除',
  repaint: '重绘',
  outpaint: '扩图',
  'bg-remove': '智能抠图',
  'aspect-ratio': '转比例',
  'text-to-image': '文生图',
  'text-to-video': '文生视频',
  'image-to-video': '图生视频',
  'email-assist': '邮件助手',
  'ecommerce-suite': '电商套图',
}
const projectId = z.string().trim().min(1).max(150)
export const taskOriginSchema = z.discriminatedUnion('entry', [
  z.object({ entry: z.literal('ecommerce'), tool: z.literal('ecommerce-suite'),
    projectId: z.uuid(), slotId: z.uuid(), batchId: z.uuid(), operationId: z.uuid(),
  }).strict(),
  z
    .object({
      entry: z.literal('workstation'),
      suiteBridgeId: z.uuid().optional(),
      tool: z.enum([
        'smart-edit',
        'relight',
        'fusion',
        'retouch',
        'variation',
        'remove',
        'repaint',
        'outpaint',
      ]),
    })
    .strict(),
  z
    .object({
      entry: z.literal('canvas'),
      tool: z.enum([
        'text-to-image',
        'variation',
        'text-to-video',
        'image-to-video',
      ]),
      projectId,
      sceneId: projectId,
      projectSource: z.enum(['local', 'cloud']),
    })
    .strict(),
  z
    .object({
      entry: z.literal('toolbox'),
      tool: z.enum(['bg-remove', 'aspect-ratio']),
    })
    .strict(),
  z
    .object({ entry: z.literal('email'), tool: z.literal('email-assist') })
    .strict(),
])
export type TaskOrigin = z.infer<typeof taskOriginSchema>

/** 来源只描述真实入口；不接受与本次能力不相容的工具标签。 */
export function validTaskOrigin(
  origin: TaskOrigin | undefined,
  capability: string,
  operation?: string,
) {
  if (!origin) return true
  const allowed: Record<string, readonly TaskTool[]> = {
    image_edit: ['smart-edit', 'relight', 'fusion', 'retouch', 'ecommerce-suite'],
    variation: ['variation'],
    text_to_image: ['text-to-image'],
    text_to_video: ['text-to-video', 'image-to-video'],
    email_assist: ['email-assist'],
    erase: ['remove'],
    repaint: ['repaint'],
    outpaint: ['outpaint', 'aspect-ratio'],
    'bg-remove': ['bg-remove'],
  }
  return (
    !!allowed[capability]?.includes(origin.tool) &&
    (capability !== 'text_to_video' ||
      origin.tool ===
        (operation === 'image_to_video' ? 'image-to-video' : 'text-to-video'))
  )
}

export type TaskState =
  'queued' | 'processing' | 'succeeded' | 'failed' | 'expired' | 'cancelled'
export type TaskBillingState =
  'none' | 'reserved' | 'settled' | 'refunded' | 'unknown'
export type ResultAvailability =
  'pending' | 'available' | 'expired' | 'unavailable'
export interface TaskCenterSummary {
  sourceKind: TaskSourceKind
  sourceId: string
  taskKey: string
  requestId: string
  tool: TaskTool | null
  capability: string
  modelProfileId: string | null
  /** 只读快照的刷新建议，不授权客户端推进或重提任务。 */
  pollAfterMs?: number
  state: TaskState
  requestedCount: number
  completedCount: number
  partial: boolean
  errorCode: string | null
  warnings: string[]
  origin: TaskOrigin | null
  billingState: TaskBillingState
  creditsReserved: number
  creditsCharged: number | null
  creditsReturned: number | null
  resultAvailability: ResultAvailability
  resultExpiresAt: string | null
  taskExpiresAt: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  outcomeVersion: string | null
  seen: boolean
  dismissed: boolean
  suite?: { projectId: string; batchId: string }
  knownCreditsCharged?: number
}
export interface TaskCenterMedia {
  kind: 'image' | 'video'
  ordinal: number
  objectKey: string
  mimeType: string
  width: number
  height: number
  url: string
  urlExpiresAt: string
  availability: ResultAvailability
  /** 只返回原任务已保存的视频信息，不补造缺失元数据。 */
  video?: Omit<import('./video-models').VideoResult, 'url' | 'expiresAt' | 'objectKey' | 'ordinal' | 'width' | 'height' | 'mimeType'>
}
export interface TaskCenterText {
  kind: 'text'
  text: string
  editedText: string | null
}
export interface TaskCenterDetail {
  task: TaskCenterSummary
  params: Record<string, unknown> | null
  errorMessage: string | null
  results: (TaskCenterMedia | TaskCenterText)[]
  children?: TaskCenterSummary[]
}
export interface TaskCenterSidebar {
  items: TaskCenterSummary[]
  activeCount: number
  unseenCount: number
  snapshotAt: string
}
export interface TaskCenterHistory {
  items: TaskCenterSummary[]
  nextCursor: string | null
  snapshotAt: string
}
export type TaskHistoryState = 'all' | 'active' | 'succeeded' | 'failed'
export const taskPresentationSchema = z
  .object({
    action: z.enum(['seen', 'dismiss']),
    outcomeVersion: z.string().regex(/^v1:[a-f0-9]{32}$/),
  })
  .strict()
export const taskHistorySchema = z.object({
  tool: z.enum(taskTools).optional(),
  state: z.enum(['all', 'active', 'succeeded', 'failed']).default('all'),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().max(2000).optional(),
})
export function taskIsActive(task: Pick<TaskCenterSummary, 'state'>) {
  return task.state === 'queued' || task.state === 'processing'
}
export function taskStateLabel(
  task: Pick<TaskCenterSummary, 'state' | 'partial'>,
) {
  return task.partial
    ? '部分完成'
    : (
        {
          queued: '排队中',
          processing: '处理中',
          succeeded: '已完成',
          failed: '失败',
          expired: '已超时',
          cancelled: '已取消',
        } as const
      )[task.state]
}
export function taskBillingLabel(
  task: Pick<
    TaskCenterSummary,
    'billingState' | 'creditsReserved' | 'creditsCharged' | 'creditsReturned' | 'knownCreditsCharged'
  > & { sourceKind?: TaskSourceKind },
) {
  if (task.sourceKind === 'suite_batch' && task.billingState === 'none') return '未预扣'
  if (task.billingState === 'none') return '免费'
  if (task.billingState === 'reserved')
    return task.creditsReserved === 0
      ? '免费额度处理中'
      : `预计消耗 ${task.creditsReserved} 积分`
  if (task.billingState === 'unknown') return task.knownCreditsCharged ? `结算中，已知扣费 ${task.knownCreditsCharged} 积分` : '结算中'
  if (task.billingState === 'refunded')
    return task.creditsReturned
      ? `已退还 ${task.creditsReturned} 积分`
      : '未扣费'
  return `${task.creditsCharged === 0 ? '免费' : `已扣 ${task.creditsCharged} 积分`}${task.creditsReturned ? `，退还 ${task.creditsReturned} 积分` : ''}`
}
