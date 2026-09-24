import type { AspectRatioSettings, BatchImage, RenderRequest, RenderResult } from './types'

export function invalidateBatch(items: BatchImage[]): BatchImage[] {
  return items.map(item => ({ ...item, status: 'pending', output: undefined, outputMime: undefined, error: undefined }))
}

interface BatchRun {
  images: BatchImage[]
  settings: AspectRatioSettings
  targetWidth: number
  targetHeight: number
  ids?: string[]
  render: (request: RenderRequest) => Promise<RenderResult>
  update: (id: string, patch: Partial<BatchImage>) => void
  shouldStop: () => boolean
}

export async function processBatch({ images, settings, targetWidth, targetHeight, ids, render, update, shouldStop }: BatchRun) {
  const targets = images.filter(item => ids ? ids.includes(item.id) : item.status !== 'succeeded')
  for (const item of targets) {
    if (shouldStop()) break
    update(item.id, { status: 'processing', error: undefined })
    try {
      const result = await render({ file: item.file, settings, targetWidth, targetHeight })
      if (shouldStop()) { update(item.id, { status: 'pending' }); break }
      if (result.width !== targetWidth || result.height !== targetHeight) {
        throw new Error('输出尺寸与目标平台不一致')
      }
      update(item.id, { status: 'succeeded', output: result.blob, outputMime: result.mimeType, error: undefined })
    } catch (error) {
      if (shouldStop()) { update(item.id, { status: 'pending' }); break }
      update(item.id, { status: 'failed', output: undefined, outputMime: undefined, error: error instanceof Error ? error.message : '图片处理失败' })
    }
  }
}
