import type { GenerationJob } from '@/editor/types'
import { i18n } from '@/i18n'

/** 视频任务的阶段文案与右栏 `GenerationTaskStatus` 保持一致。 */
export type GenerationPhase = 'submitting' | 'queued' | 'generating' | 'transferring'

const PHASE_KEYS = {
  submitting: 'canvas:placeholder.phases.submitting',
  queued: 'canvas:placeholder.phases.queued',
  generating: 'canvas:placeholder.phases.generating',
  transferring: 'canvas:placeholder.phases.transferring',
} as const

/** 挂钟时长：60 秒以内只报秒，超过就报分秒。 */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return i18n.t('canvas:placeholder.elapsed.seconds', { seconds })
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest
    ? i18n.t('canvas:placeholder.elapsed.minutesSeconds', { minutes, seconds: rest })
    : i18n.t('canvas:placeholder.elapsed.minutes', { minutes })
}

/**
 * 生成占位框的第二行文案：排队/生成中带上已用时长（用户最想知道"还要不要等"），
 * 失败态给下一步操作。与右侧 `GenerationTaskStatus` 的阶段文案共用一套说法。
 */
export function placeholderDetail(
  status: GenerationJob['status'] | undefined,
  job: GenerationJob | undefined,
  now = Date.now(),
  phase?: GenerationPhase,
): string {
  if (status === 'failed' || status === 'cancelled') return i18n.t('canvas:placeholder.detail.failed')
  // 视频任务阶段更长，"转存中"这段最容易让人以为卡死，阶段优先于通用文案。
  if (phase && status !== 'succeeded') {
    const label = i18n.t(PHASE_KEYS[phase])
    if (phase === 'queued' || phase === 'submitting') {
      return job ? i18n.t('canvas:placeholder.detail.phaseWaiting', { label, elapsed: formatElapsed(now - Date.parse(job.createdAt)) }) : label
    }
    return job ? i18n.t('canvas:placeholder.detail.phaseElapsed', { label, elapsed: formatElapsed(now - Date.parse(job.createdAt)) }) : label
  }
  if (status === 'processing') {
    return job
      ? i18n.t('canvas:placeholder.detail.processingElapsed', { elapsed: formatElapsed(now - Date.parse(job.createdAt)) })
      : i18n.t('canvas:placeholder.detail.processingGeneric')
  }
  if (status === 'queued' || status === 'pending') {
    return job
      ? i18n.t('canvas:placeholder.detail.queuedElapsed', { elapsed: formatElapsed(now - Date.parse(job.createdAt)) })
      : i18n.t('canvas:placeholder.detail.waiting')
  }
  return i18n.t('canvas:placeholder.detail.waiting')
}
