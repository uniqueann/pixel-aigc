import type { Asset, ImageAsset, VideoAsset } from '@/editor/types'
import type { GenerationTask } from '@/types'

/** 云端上传可能更换对象键，优先按稳定结果标识保留同一张图的运行时引用。 */
export function resultAssetForTask(task: GenerationTask<unknown> | undefined, resultIndex: number, assets: Record<string, Asset>): ImageAsset | VideoAsset | undefined {
  if (!task) return undefined
  const image = task.resultVideos?.[resultIndex] ?? task.resultImages?.[resultIndex]
  const stableId = image?.ordinal === undefined ? undefined : `asset:${task.id}:o${image.ordinal}`
  const stable = stableId ? assets[stableId] : undefined
  if (stable?.type === 'image' || stable?.type === 'video') return stable
  const legacy = assets[`asset:${task.id}:${resultIndex}`]
  if (legacy?.type === 'image' || legacy?.type === 'video') return legacy
  return Object.values(assets).find((asset): asset is ImageAsset | VideoAsset => (asset.type === 'image' || asset.type === 'video') && !!image?.objectKey && (asset.objectKey ?? asset.storage?.objectKey) === image.objectKey)
}
