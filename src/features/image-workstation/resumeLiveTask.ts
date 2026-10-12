import { recoverSyncResult } from '@/services/api/billing'
import { findTaskByRequest, getTask } from '@/services/api/task'
import { Capability, type GenerationTask } from '@/types'
import type { WorkstationLiveSession } from './liveSession'

const ACTIVE = new Set(['pending', 'queued', 'processing'])
export const LIVE_TASK_POLL_MS = import.meta.env.MODE === 'test' ? 30 : 2000
const MISSING_GRACE_MS = 120_000

export type LiveTaskView =
  | { phase: 'processing'; task: GenerationTask<unknown>; handoff?: boolean }
  | { phase: 'succeeded'; task: GenerationTask<unknown> }
  | { phase: 'failed'; task: GenerationTask<unknown> }
  | { phase: 'missing' }
  | { phase: 'absent' }

function statusOf(error: unknown) {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : undefined
}
function stamp(session: WorkstationLiveSession) {
  return new Date(session.createdAt).toISOString()
}
function paramsFor(session: WorkstationLiveSession) {
  if (session.tool === 'repaint') return { mode: 'repaint' }
  if (session.tool === 'remove') return { mode: 'remove' }
  return {}
}
export function liveTaskPlaceholder(session: WorkstationLiveSession, capability: Capability): GenerationTask<unknown> {
  const createdAt = stamp(session)
  return {
    id: session.sourceId ?? session.requestId,
    requestId: session.requestId,
    capability,
    status: 'processing',
    params: paramsFor(session),
    creditsCost: 0,
    createdAt,
    updatedAt: createdAt,
  }
}

async function loadImageJob(session: WorkstationLiveSession, signal?: AbortSignal): Promise<GenerationTask<unknown> | undefined> {
  if (session.sourceId) {
    try { return await getTask(session.sourceId, { signal }) }
    catch (error) {
      if (statusOf(error) !== 404) throw error
    }
  }
  return findTaskByRequest(session.requestId)
}

export async function loadWorkstationLiveTask(session: WorkstationLiveSession, capability: Capability, signal?: AbortSignal): Promise<LiveTaskView> {
  if (session.sourceKind === 'image_job') {
    const task = await loadImageJob(session, signal)
    if (!task) return { phase: 'missing' }
    if (ACTIVE.has(task.status)) return { phase: 'processing', task, handoff: true }
    if (task.status === 'succeeded') return { phase: 'succeeded', task }
    return { phase: 'failed', task }
  }
  try {
    const recovered = await recoverSyncResult(session.requestId, session.owner)
    if (signal?.aborted) throw signal.reason ?? new DOMException('已取消', 'AbortError')
    const base = liveTaskPlaceholder(session, capability)
    if (recovered.state === 'reserved') return { phase: 'processing', task: base }
    if (recovered.state === 'settled' && recovered.result) {
      const now = new Date().toISOString()
      return {
        phase: 'succeeded',
        task: {
          ...base,
          status: 'succeeded',
          updatedAt: now,
          resultUrls: [recovered.result.url],
          resultImages: [{
            url: recovered.result.url,
            objectKey: recovered.result.objectKey,
            mimeType: recovered.result.mimeType,
            expiresAt: recovered.result.expiresAt,
            width: 0,
            height: 0,
            ordinal: 0,
          }],
        },
      }
    }
    return {
      phase: 'failed',
      task: { ...base, status: 'failed', updatedAt: new Date().toISOString(), errorCode: recovered.errorCode, errorMessage: '任务没有完成' },
    }
  } catch (error) {
    if (statusOf(error) === 404) return { phase: 'missing' }
    throw error
  }
}

function aborted(error: unknown) {
  return error instanceof DOMException && error.name === 'AbortError'
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason ?? new DOMException('已取消', 'AbortError')); return }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('已取消', 'AbortError'))
    }, { once: true })
  })
}

/** 只读取已有任务。进行中的同步任务继续查询，直到终态或调用方取消。 */
export async function watchWorkstationLiveTask(options: {
  session: WorkstationLiveSession
  capability: Capability
  signal: AbortSignal
  onUpdate: (view: LiveTaskView) => void
  now?: () => number
  pollMs?: number
  load?: typeof loadWorkstationLiveTask
}) {
  const now = options.now ?? Date.now
  const pollMs = options.pollMs ?? LIVE_TASK_POLL_MS
  const load = options.load ?? loadWorkstationLiveTask
  options.onUpdate({ phase: 'processing', task: liveTaskPlaceholder(options.session, options.capability) })
  while (!options.signal.aborted) {
    let view: LiveTaskView
    try { view = await load(options.session, options.capability, options.signal) }
    catch (error) {
      if (options.signal.aborted || aborted(error)) return
      await wait(pollMs, options.signal).catch(() => undefined)
      continue
    }
    if (options.signal.aborted) return
    if (view.phase === 'missing') {
      if (now() - options.session.createdAt > MISSING_GRACE_MS) {
        options.onUpdate({ phase: 'absent' })
        return
      }
      await wait(pollMs, options.signal).catch(() => undefined)
      continue
    }
    options.onUpdate(view)
    if (view.phase !== 'processing' || view.handoff) return
    await wait(pollMs, options.signal).catch(() => undefined)
    if (options.signal.aborted) return
  }
}
