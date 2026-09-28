import type { ImageResolution, NormalizedImageRequest } from '../../../shared/image-generation.js'
import {
  DRAGONCODE_FOUR_K_RATIOS,
  DRAGONCODE_MAX_INPUT_BYTES,
  DRAGONCODE_RATIOS,
  DRAGONCODE_SIZES,
  RESOLUTION_DOWNGRADED_4K,
  mapDragonCodeSize,
  nearestRatio,
  ratioValue,
} from '../../../shared/image-models.js'
import type { MappedImageRequest } from '../types.js'

export { mapDragonCodeSize, nearestRatio }

export const DRAGONCODE_CAPABILITIES = {
  operations: ['image_edit', 'text_to_image', 'variation'] as const,
  supportsMask: false,
  maxRefImages: 16,
  maxN: 1,
  sizeMode: 'ratio' as const,
  ratios: [...DRAGONCODE_SIZES],
  resolutions: ['1k', '2k', '4k'] as const,
  resolutionRatioConstraints: { '4k': [...DRAGONCODE_FOUR_K_RATIOS] },
  acceptsInput: ['url', 'data'] as Array<'url' | 'data'>,
  maxInputBytes: DRAGONCODE_MAX_INPUT_BYTES,
  execution: 'async' as const,
}

function isKnownRatio(value: string): value is typeof DRAGONCODE_RATIOS[number] {
  return (DRAGONCODE_RATIOS as readonly string[]).includes(value)
}

function isKnownSize(value: string): value is typeof DRAGONCODE_SIZES[number] {
  return (DRAGONCODE_SIZES as readonly string[]).includes(value)
}

function sourceSize(req: NormalizedImageRequest) {
  const primary = req.images[0]
  if (primary?.width && primary.height) return { width: primary.width, height: primary.height }
  if (req.target.size) return req.target.size
  if (req.target.aspectRatio && isKnownRatio(req.target.aspectRatio)) {
    const [width, height] = req.target.aspectRatio.split(':').map(Number)
    return { width, height }
  }
  return { width: 1, height: 1 }
}

function applyResolution(size: string, resolution: ImageResolution) {
  if (resolution !== '4k' || (DRAGONCODE_FOUR_K_RATIOS as readonly string[]).includes(size)) {
    return { size, resolution, warnings: [] as string[] }
  }
  return { size, resolution: '2k' as const, warnings: [RESOLUTION_DOWNGRADED_4K] }
}

export function mapDragonCodeRequest(req: NormalizedImageRequest, model: string): MappedImageRequest {
  const count = Math.min(4, Math.max(1, Math.round(req.count || 1)))
  const resolution = req.target.resolution ?? '2k'
  if (req.target.aspectRatio === 'auto' && isKnownSize('auto')) {
    const mapped = applyResolution('auto', resolution)
    const source = sourceSize(req)
    return {
      providerParams: { model, size: mapped.size, resolution: mapped.resolution, n: 1 },
      fanOut: count,
      warnings: mapped.warnings,
      expectedAspect: source.width / source.height,
    }
  }
  const mapped = req.target.aspectRatio && isKnownRatio(req.target.aspectRatio)
    ? applyResolution(req.target.aspectRatio, resolution)
    : mapDragonCodeSize(sourceSize(req).width, sourceSize(req).height, resolution)
  return {
    providerParams: { model, size: mapped.size, resolution: mapped.resolution, n: 1 },
    fanOut: count,
    warnings: mapped.warnings,
    expectedAspect: ratioValue(mapped.size),
  }
}
