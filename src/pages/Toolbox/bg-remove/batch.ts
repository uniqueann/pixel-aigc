import type { BatchImage } from './types'
import { BG_REMOVE_CONCURRENCY } from './types'

interface BatchRun {
  images: BatchImage[]
  ids?: string[]
  concurrency?: number
  remove: (image: BatchImage) => Promise<Blob>
  compose: (image: BatchImage, matte: Blob) => Promise<{ blob: Blob; mimeType: string }>
  update: (id: string, patch: Partial<BatchImage>) => void
  shouldStop: () => boolean
}

export function imagesNeedingRemoval(images: BatchImage[], ids?: string[]) {
  return images.filter(image => {
    if (ids && !ids.includes(image.id)) return false
    if (image.matte && image.status !== 'failed') return false
    return ids ? true : image.status !== 'succeeded'
  })
}

export async function processRemovalBatch({
  images, ids, concurrency = BG_REMOVE_CONCURRENCY, remove, compose, update, shouldStop,
}: BatchRun) {
  const targets = imagesNeedingRemoval(images, ids)
  let index = 0

  async function runOne(item: BatchImage) {
    if (shouldStop()) return
    update(item.id, { status: 'processing', error: undefined })
    try {
      const matte = item.matte ?? await remove(item)
      if (shouldStop()) { update(item.id, { status: 'pending', matte: item.matte }); return }
      const output = await compose(item, matte)
      if (shouldStop()) { update(item.id, { status: 'pending', matte }); return }
      update(item.id, { status: 'succeeded', matte, output: output.blob, outputMime: output.mimeType, error: undefined })
    } catch (error) {
      if (shouldStop()) { update(item.id, { status: 'pending' }); return }
      update(item.id, {
        status: 'failed', output: undefined, outputMime: undefined,
        error: error instanceof Error ? error.message : '抠图失败',
      })
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

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, targets.length)) }, () => worker()))
}

export async function recompositeBatch(
  images: BatchImage[],
  compose: (image: BatchImage, matte: Blob) => Promise<{ blob: Blob; mimeType: string }>,
  update: (id: string, patch: Partial<BatchImage>) => void,
) {
  for (const image of images) {
    if (!image.matte) continue
    const output = await compose(image, image.matte)
    update(image.id, { status: 'succeeded', output: output.blob, outputMime: output.mimeType, error: undefined })
  }
}
