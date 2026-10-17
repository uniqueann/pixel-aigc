import { taskSourceKinds, type TaskCenterSummary, type TaskSourceKind, type TaskTool } from '@shared/task-center'

export interface TaskRouteIdentity { sourceKind: TaskSourceKind; sourceId: string; taskKey: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export function parseTaskRoute(value: string | null): TaskRouteIdentity | null {
  if (!value) return null
  const [kind, id, extra] = value.split(':')
  if (extra !== undefined || !taskSourceKinds.includes(kind as TaskSourceKind) || !uuid.test(id ?? '')) return null
  return { sourceKind: kind as TaskSourceKind, sourceId: id.toLowerCase(), taskKey: `${kind}:${id.toLowerCase()}` }
}
const workstation: TaskTool[] = ['smart-edit','relight','fusion','retouch','variation','remove','repaint','outpaint']
export function taskDestination(task: TaskCenterSummary): string | null {
  const origin = task.origin
  const tool = task.tool
  if (task.sourceKind === 'suite_batch' && task.suite) return `/ecommerce/${task.suite.projectId}?batch=${task.suite.batchId}`
  if (!tool) return null
  const params = new URLSearchParams({ task: task.taskKey })
  if (origin?.entry === 'ecommerce') {
    params.set('slot', origin.slotId)
    params.set('batch', origin.batchId)
    return `/ecommerce/${origin.projectId}?${params}`
  }
  if (origin?.entry === 'canvas') {
    params.set('projectId', origin.projectId); params.set('projectSource', origin.projectSource); params.set('sceneId', origin.sceneId)
    return `/canvas/${origin.tool}?${params}`
  }
  if (workstation.includes(tool)) return `/image-workstation/${tool}?${params}`
  if (tool === 'bg-remove' || tool === 'aspect-ratio') return `/toolbox/${tool}?${params}`
  if (tool === 'email-assist') { params.set('mode','single'); return `/email?${params}` }
  // 没有原项目来源的画布任务只留在详情，不猜测项目或创建新画布。
  return null
}
export function taskMatchesTool(task: TaskCenterSummary, tools: readonly TaskTool[], canvasProjectId?: string) {
  if (!task.tool || !tools.includes(task.tool)) return false
  if (canvasProjectId !== undefined) return task.origin?.entry === 'canvas' && task.origin.projectId === canvasProjectId
  return task.origin?.entry !== 'canvas'
}
