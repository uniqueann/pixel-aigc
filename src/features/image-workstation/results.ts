import type { ImageAsset } from '@/editor/types'
import type { GenerationTask } from '@/types'
import { SOURCE_ECHO_ERROR } from './sourceEcho'

export { SOURCE_ECHO_ERROR }

export function readSourceImageUrl(params: unknown): string | undefined {
  if (!params || typeof params !== 'object' || !('sourceImageUrl' in params)) return undefined
  const url = (params as { sourceImageUrl?: unknown }).sourceImageUrl
  return typeof url === 'string' && url ? url : undefined
}

export function excludeSourceEchoes(task: GenerationTask<unknown>, assets: ImageAsset[]) {
  const sourceUrl = readSourceImageUrl(task.params)
  if (!sourceUrl) return assets
  return assets.filter((asset) => asset.url !== sourceUrl)
}

export function finalizeWorkstationResults(
  task: GenerationTask<unknown>,
  assets: ImageAsset[],
): { assets: ImageAsset[]; error?: string } {
  if (task.status !== 'succeeded') return { assets: [] }
  const generated = excludeSourceEchoes(task, assets)
  if (generated.length > 0) return { assets: generated }
  return {
    assets: [],
        error: assets.length === 0
      ? '任务已完成，但接口没有返回图片结果'
      : SOURCE_ECHO_ERROR,
  }
}
