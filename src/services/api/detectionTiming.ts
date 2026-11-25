import { i18n } from '@/i18n'
import type { DetectionClientTiming } from '@shared/detection'

export async function measureClientDetection<T>(timings: DetectionClientTiming, stage: keyof DetectionClientTiming, action: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try { return await action() }
  finally { timings[stage] = Math.min(300_000, Math.round(performance.now() - start)) }
}

export function checkDetectionSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException(i18n.t('errors:client.detectionCancelled'), 'AbortError')
}

/** Fallback deadline wrapper for environments without AbortSignal.any; shares timeout with response body reads. */
export function detectionDeadline(parent: AbortSignal | undefined, ms: number) {
  const controller = new AbortController()
  const cancel = () => controller.abort(parent?.reason ?? new DOMException(i18n.t('errors:client.detectionCancelled'), 'AbortError'))
  parent?.addEventListener('abort', cancel, { once: true })
  if (parent?.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new DOMException(i18n.t('errors:client.detectionTimeout'), 'TimeoutError')), ms)
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', cancel) } }
}
