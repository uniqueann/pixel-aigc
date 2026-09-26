import { cropFocusForImage } from './subjectFocus'
import type { AspectRatioSettings, BatchImage, RenderRequest, RenderResult, SubjectDetection } from './types'

export function invalidateBatch(items: BatchImage[]): BatchImage[] {
  return items.map(item => ({ ...item, status: 'pending', output: undefined, outputMime: undefined, error: undefined, cropFocus: undefined }))
}

interface BatchRun {
  images: BatchImage[]
  settings: AspectRatioSettings
  targetWidth: number
  targetHeight: number
  ids?: string[]
  render: (request: RenderRequest) => Promise<RenderResult>
  detect?: (image: Pick<BatchImage, 'file' | 'width' | 'height'>) => Promise<SubjectDetection>
  update: (id: string, patch: Partial<BatchImage>) => void
  shouldStop: () => boolean
}

export async function processBatch({ images, settings, targetWidth, targetHeight, ids, render, detect, update, shouldStop }: BatchRun) {
  const targets = images.filter(item => ids ? ids.includes(item.id) : item.status !== 'succeeded')
  for (const item of targets) {
    if (shouldStop()) break
    update(item.id, { status: 'processing', error: undefined, cropFocus: undefined })
    try {
      const cropFocus = await cropFocusForImage(item, settings, targetWidth, targetHeight, detect)
      const result = await render({
        file: item.file,
        settings: cropFocus ? { ...settings, fx: cropFocus.fx, fy: cropFocus.fy } : settings,
        targetWidth,
        targetHeight,
      })
      if (shouldStop()) { update(item.id, { status: 'pending' }); break }
      if (result.width !== targetWidth || result.height !== targetHeight) {
        throw new Error('输出尺寸与目标平台不一致')
      }
      update(item.id, { status: 'succeeded', output: result.blob, outputMime: result.mimeType, error: undefined, cropFocus })
    } catch (error) {
      if (shouldStop()) { update(item.id, { status: 'pending' }); break }
      update(item.id, {
        status: 'failed', output: undefined, outputMime: undefined, cropFocus: undefined,
        error: error instanceof Error ? error.message : '图片处理失败',
      })
    }
  }
}
