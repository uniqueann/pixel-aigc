import { containRect, sameAspect } from './geometry'
import type { AspectRatioSettings, BatchImage, RenderResult } from './types'

export const OUTPAINT_CONCURRENCY = 3

export interface ExpansionPlan {
  mode: 'local' | 'remote'
  originOffset: { x: number; y: number }
  sourceSize: { width: number; height: number }
}

export function expansionPlan(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
): ExpansionPlan {
  if (sameAspect(sourceWidth, sourceHeight, targetWidth, targetHeight)) {
    return { mode: 'local', originOffset: { x: 0, y: 0 }, sourceSize: { width: targetWidth, height: targetHeight } }
  }
  const fitted = containRect(sourceWidth, sourceHeight, targetWidth, targetHeight)
  const fillsCanvas = fitted.width === targetWidth && fitted.height === targetHeight
  return {
    mode: fillsCanvas ? 'local' : 'remote',
    originOffset: { x: fitted.x, y: fitted.y },
    sourceSize: { width: fitted.width, height: fitted.height },
  }
}

interface OutpaintRun {
  images: BatchImage[]
  settings: AspectRatioSettings
  targetWidth: number
  targetHeight: number
  ids?: string[]
  concurrency?: number
  renderLocal: (image: BatchImage) => Promise<RenderResult>
  expandRemote: (image: BatchImage, plan: ExpansionPlan) => Promise<RenderResult>
  update: (id: string, patch: Partial<BatchImage>) => void
  shouldStop: () => boolean
}

export async function processOutpaintBatch({
  images, targetWidth, targetHeight, ids, concurrency = OUTPAINT_CONCURRENCY,
  renderLocal, expandRemote, update, shouldStop,
}: OutpaintRun) {
  const targets = images.filter(item => ids ? ids.includes(item.id) : item.status !== 'succeeded')
  let index = 0
  let active = 0
  let peak = 0

  async function runOne(item: BatchImage) {
    if (shouldStop()) return
    update(item.id, { status: 'processing', error: undefined })
    active += 1
    peak = Math.max(peak, active)
    try {
      const plan = expansionPlan(item.width, item.height, targetWidth, targetHeight)
      const result = plan.mode === 'local' ? await renderLocal(item) : await expandRemote(item, plan)
      if (shouldStop()) { update(item.id, { status: 'pending' }); return }
      if (result.width !== targetWidth || result.height !== targetHeight) throw new Error('输出尺寸与目标平台不一致')
      update(item.id, { status: 'succeeded', output: result.blob, outputMime: result.mimeType, error: undefined })
    } catch (error) {
      if (shouldStop()) { update(item.id, { status: 'pending' }); return }
      update(item.id, {
        status: 'failed', output: undefined, outputMime: undefined,
        error: error instanceof Error ? error.message : '扩图失败',
      })
    } finally {
      active -= 1
    }
  }

  async function worker() {
    while (!shouldStop()) {
      const current = index
      index += 1
      if (current >= targets.length) return
      await runOne(targets[current])
    }
  }

  const workers = Math.min(concurrency, Math.max(1, targets.length))
  await Promise.all(Array.from({ length: workers }, () => worker()))
  return { peak }
}
