import type { DetectionClientTiming } from '@shared/detection'

export async function measureClientDetection<T>(timings: DetectionClientTiming, stage: keyof DetectionClientTiming, action: () => Promise<T>): Promise<T> {
  const start = performance.now()
  try { return await action() }
  finally { timings[stage] = Math.min(300_000, Math.round(performance.now() - start)) }
}

export function checkDetectionSignal(signal?: AbortSignal) {
  if (signal?.aborted) throw signal.reason ?? new DOMException('检测已取消', 'AbortError')
}

/** 兼容没有 AbortSignal.any 的环境，响应正文也使用同一个截止信号。 */
export function detectionDeadline(parent: AbortSignal | undefined, ms: number) {
  const controller = new AbortController()
  const cancel = () => controller.abort(parent?.reason ?? new DOMException('检测已取消', 'AbortError'))
  parent?.addEventListener('abort', cancel, { once: true })
  if (parent?.aborted) cancel()
  const timer = setTimeout(() => controller.abort(new DOMException('检测超时', 'TimeoutError')), ms)
  return { signal: controller.signal, dispose: () => { clearTimeout(timer); parent?.removeEventListener('abort', cancel) } }
}
