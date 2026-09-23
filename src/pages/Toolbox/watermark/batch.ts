import type { BatchImage, RenderRequest, RenderResult, WatermarkSettings } from './types'

export function invalidateBatch(items: BatchImage[]): BatchImage[] {
  return items.map(item => ({ ...item, status: 'pending', output: undefined, outputMime: undefined, error: undefined }))
}

interface BatchRun {
  images: BatchImage[]
  settings: WatermarkSettings
  ids?: string[]
  render: (request: RenderRequest) => Promise<RenderResult>
  update: (id: string, patch: Partial<BatchImage>) => void
  shouldStop: () => boolean
}

export async function processBatch({ images, settings, ids, render, update, shouldStop }: BatchRun) {
  const targets = images.filter(item => ids ? ids.includes(item.id) : item.status !== 'succeeded')
  for (const item of targets) {
    if (shouldStop()) break
    update(item.id, { status: 'processing', error: undefined })
    try {
      const result = await render({ file: item.file, sourceMime: item.sourceMime, settings })
      if (shouldStop()) { update(item.id, { status: 'pending' }); break }
      update(item.id, { status: 'succeeded', output: result.blob, outputMime: result.mimeType, error: undefined })
    } catch (error) {
      if (shouldStop()) { update(item.id, { status: 'pending' }); break }
      update(item.id, { status: 'failed', error: error instanceof Error ? error.message : '图片处理失败' })
    }
  }
}
