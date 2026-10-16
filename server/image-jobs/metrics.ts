import type { ImageJobRow } from './types.js'

type Phase = 'lookup' | 'lease' | 'prepare' | 'reconcile' | 'status' | 'download'
  | 'postprocess' | 'transfer-intent' | 'store' | 'billing' | 'persist' | 'present'
interface ClockAndLog {
  now: () => number
  log: (entry: Record<string, unknown>) => void
}
interface PhaseNumbers {
  ordinal?: number
  scheduledLateMs?: number
}

/** 只记录实际响应里的提示；终态快照不重复产生展示或完成事件。 */
export function observeImagePollHint(
  runtime: ClockAndLog,
  job: Pick<ImageJobRow, 'id' | 'request_id' | 'provider' | 'model_profile_id' | 'scope'>,
  pollAfterMs: number | undefined,
) {
  if (pollAfterMs === undefined) return
  try {
    runtime.log({ evt: 'image-job-poll-hint', jobId: job.id, requestId: job.request_id,
      provider: job.provider, modelProfileId: job.model_profile_id, scope: job.scope, pollAfterMs })
  } catch { /* 观测失败不能改变响应。 */ }
}

/** 白名单字段用于关联分段，不记录提示词、原图、签名地址、对象键或异常正文。 */
export async function measureImagePhase<T>(
  runtime: ClockAndLog,
  job: Pick<ImageJobRow, 'id' | 'request_id' | 'provider' | 'model_profile_id' | 'scope'>,
  phase: Phase,
  operation: () => Promise<T>,
  numbers: PhaseNumbers = {},
): Promise<T> {
  const started = runtime.now()
  let outcome: 'success' | 'failed' = 'failed'
  try {
    const result = await operation()
    outcome = 'success'
    return result
  } finally {
    const elapsed = runtime.now() - started
    try {
      runtime.log({
        evt: 'image-job-phase', jobId: job.id, requestId: job.request_id,
        provider: job.provider, modelProfileId: job.model_profile_id, scope: job.scope,
        phase, ms: Number.isFinite(elapsed) ? Math.max(0, Math.round(elapsed)) : 0, outcome,
        ...(numbers.ordinal !== undefined ? { ordinal: numbers.ordinal } : {}),
        ...(numbers.scheduledLateMs !== undefined ? { scheduledLateMs: numbers.scheduledLateMs } : {}),
      })
    } catch { /* 观测失败不能改变生成、转存或结算结果。 */ }
  }
}
