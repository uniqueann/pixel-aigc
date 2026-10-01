import { containRect, sameAspect } from './geometry'
import type { AspectRatioSettings, BatchImage, RenderResult } from './types'
import { presetOutpaintSize, validateOutpaintOutputSize, type OutpaintOutputMode } from '@shared/outpaint'

/** 万相 wanx2.1-imageedit 创建任务 RPS 是 2，同时处理中的任务最多 2 个。 */
export const OUTPAINT_CONCURRENCY = 2

export function outpaintProgressLabel(completed: number, total: number, names: string[]) {
  const shown = names.slice(0, 2).join('、')
  const more = names.length > 2 ? ` 等 ${names.length} 张` : ''
  const current = shown ? `，当前 ${shown}${more}` : ''
  return `正在智能扩展，已完成 ${completed} / ${total}${current}`
}

export interface ExpansionPlan {
  mode: 'local' | 'remote'
  originOffset: { x: number; y: number }
  sourceSize: { width: number; height: number }
  targetSize: { width: number; height: number }
}

export function expansionPlan(
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number,
  outputMode: OutpaintOutputMode = 'platform',
): ExpansionPlan {
  const targetSize = presetOutpaintSize(sourceWidth, sourceHeight, targetWidth, targetHeight, outputMode)
  targetWidth = targetSize.width
  targetHeight = targetSize.height
  if (sameAspect(sourceWidth, sourceHeight, targetWidth, targetHeight)) {
    return { mode: 'local', originOffset: { x: 0, y: 0 }, sourceSize: targetSize, targetSize }
  }
  const fitted = outputMode === 'original'
    ? { width: sourceWidth, height: sourceHeight, x: Math.floor((targetWidth - sourceWidth) / 2), y: Math.floor((targetHeight - sourceHeight) / 2) }
    : containRect(sourceWidth, sourceHeight, targetWidth, targetHeight)
  const fillsCanvas = fitted.width === targetWidth && fitted.height === targetHeight
  return {
    mode: fillsCanvas ? 'local' : 'remote',
    originOffset: { x: fitted.x, y: fitted.y },
    sourceSize: { width: fitted.width, height: fitted.height },
    targetSize,
  }
}

interface OutpaintRun {
  images: BatchImage[]
  settings: AspectRatioSettings
  targetWidth: number
  targetHeight: number
  ids?: string[]
  concurrency?: number
  renderLocal: (image: BatchImage, plan: ExpansionPlan) => Promise<RenderResult>
  expandRemote: (image: BatchImage, plan: ExpansionPlan) => Promise<RenderResult>
  update: (id: string, patch: Partial<BatchImage>) => void
  shouldStop: () => boolean
}

export async function processOutpaintBatch({
  images, settings, targetWidth, targetHeight, ids, concurrency = OUTPAINT_CONCURRENCY,
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
      const plan = expansionPlan(item.width, item.height, targetWidth, targetHeight, settings.outpaintOutputMode)
      if (plan.mode === 'remote') validateOutpaintOutputSize(plan.targetSize.width, plan.targetSize.height)
      const result = plan.mode === 'local' ? await renderLocal(item, plan) : await expandRemote(item, plan)
      if (shouldStop()) { update(item.id, { status: 'pending' }); return }
      if (result.width !== plan.targetSize.width || result.height !== plan.targetSize.height) throw new Error('输出尺寸与预计尺寸不一致')
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
