export type DetectionObserver = (entry: Record<string, string | number>) => void

/** 失败也保留阶段耗时，多次编码等重复阶段累加。 */
export async function measureDetection<T>(log: DetectionObserver | undefined, stage: string, action: () => Promise<T>): Promise<T> {
  const started = performance.now()
  try { return await action() }
  finally { log?.({ stage, ms: Math.round(performance.now() - started) }) }
}

export function measureDetectionSync<T>(log: DetectionObserver | undefined, stage: string, action: () => T): T {
  const started = performance.now()
  try { return action() }
  finally { log?.({ stage, ms: Math.round(performance.now() - started) }) }
}
