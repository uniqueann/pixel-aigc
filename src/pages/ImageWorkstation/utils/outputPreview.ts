import type { PublicImageModel } from '@/services/api/imageModels'
import { mapDragonCodeSize, nearestRatio } from '@shared/image-models'

/** 当前模型、原图尺寸与分辨率下，用户实际会得到的输出尺寸。 */
export function outputPreview(
  model: PublicImageModel | undefined,
  sourceSize: { width: number; height: number } | undefined,
  resolution: '1k' | '2k' | '4k',
) {
  if (!sourceSize) return undefined
  const ratios = model?.ui.ratios?.filter(ratio => ratio.includes(':'))
  if (model && model.provider !== 'dragoncode' && ratios?.length) {
    const size = nearestRatio(sourceSize.width, sourceSize.height, ratios)
    const allowed = model.ui.resolutionRatioConstraints?.[resolution]
    const downgraded = resolution === '4k' && !!allowed && !allowed.includes(size)
    const effective = downgraded
      ? (model.ui.resolutions.includes('2k') ? '2k' as const : resolution)
      : (model.ui.resolutions.includes(resolution) ? resolution : model.ui.resolutions[0])
    return { size, resolution: effective }
  }
  return mapDragonCodeSize(sourceSize.width, sourceSize.height, resolution)
}
