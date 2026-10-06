import type { ImageResolution, NormalizedImageRequest } from '../../../shared/image-generation.js'
import { RESOLUTION_DOWNGRADED_4K, nearestRatio, ratioValue } from '../../../shared/image-models.js'
import type { MappedImageRequest } from '../types.js'
import { qwenImageSettings, resolveQwenEnableThinking } from './config.js'

export const QWEN_IMAGE_RATIOS = ['1:1', '4:3', '3:4', '16:9', '9:16'] as const
export type QwenImageRatio = typeof QWEN_IMAGE_RATIOS[number]

/** 总像素下限、上限，以及官方 1K/2K 计费分界（面积 ≤ 2,250,000 为 1K）。 */
export const QWEN_MIN_PIXELS = 512 * 512
export const QWEN_MAX_PIXELS = 2048 * 2048
export const QWEN_OUTPUT_1K_MAX_PIXELS = 2_250_000

/**
 * 像素取自旧版 qwen-image 推荐分辨率。3.0 文档只约束面积和宽高比，没有写对齐倍数。
 * 下表都在 512²–2048² 内、边长是 16 的倍数，并且 1K/2K 落在计费分界两侧。
 */
export const QWEN_IMAGE_SIZES: Record<QwenImageRatio, Record<'1k' | '2k', string>> = {
  '1:1': { '1k': '1328*1328', '2k': '2048*2048' },
  '4:3': { '1k': '1472*1104', '2k': '2368*1728' },
  '3:4': { '1k': '1104*1472', '2k': '1728*2368' },
  '16:9': { '1k': '1664*928', '2k': '2688*1536' },
  '9:16': { '1k': '928*1664', '2k': '1536*2688' },
}

export const QWEN_IMAGE_CAPABILITIES = {
  operations: ['text_to_image'] as const,
  supportsMask: false,
  maxRefImages: 0,
  maxN: 4,
  sizeMode: 'ratio' as const,
  ratios: [...QWEN_IMAGE_RATIOS],
  resolutions: ['1k', '2k'] as const,
  acceptsInput: ['url'] as Array<'url' | 'data'>,
  execution: 'async' as const,
}

export function parseQwenSize(size: string) {
  const match = /^(\d+)\*(\d+)$/.exec(size)
  if (!match) return undefined
  return { width: Number(match[1]), height: Number(match[2]) }
}

export function qwenOutputTier(width: number, height: number): '1k' | '2k' {
  return width * height > QWEN_OUTPUT_1K_MAX_PIXELS ? '2k' : '1k'
}

function isQwenRatio(value: string): value is QwenImageRatio {
  return (QWEN_IMAGE_RATIOS as readonly string[]).includes(value)
}

function requestPixels(req: NormalizedImageRequest) {
  const primary = req.images[0]
  if (primary?.width && primary.height) return { width: primary.width, height: primary.height }
  if (req.target.size?.width && req.target.size.height) return req.target.size
  return { width: 1, height: 1 }
}

export function mapQwenImageSize(width: number, height: number, resolution: ImageResolution | undefined) {
  const ratio = nearestRatio(width, height, QWEN_IMAGE_RATIOS)
  const tier = resolution === '1k' ? '1k' : '2k'
  const warnings = resolution && resolution !== '1k' && resolution !== '2k' ? [RESOLUTION_DOWNGRADED_4K] : []
  return {
    ratio: ratio as QwenImageRatio,
    resolution: tier,
    size: QWEN_IMAGE_SIZES[ratio as QwenImageRatio][tier],
    warnings,
  }
}

export function mapQwenImageRequest(req: NormalizedImageRequest, model: string): MappedImageRequest {
  const count = Math.min(4, Math.max(1, Math.round(req.count || 1)))
  const pixels = requestPixels(req)
  const mapped = req.target.aspectRatio && isQwenRatio(req.target.aspectRatio)
    ? {
        ratio: req.target.aspectRatio,
        resolution: req.target.resolution === '1k' ? '1k' as const : '2k' as const,
        size: QWEN_IMAGE_SIZES[req.target.aspectRatio][req.target.resolution === '1k' ? '1k' : '2k'],
        warnings: req.target.resolution && req.target.resolution !== '1k' && req.target.resolution !== '2k'
          ? [RESOLUTION_DOWNGRADED_4K]
          : [],
      }
    : mapQwenImageSize(pixels.width, pixels.height, req.target.resolution)
  const requested = req.extra?.enableThinking === true
  return {
    providerParams: {
      model,
      size: mapped.size,
      resolution: mapped.resolution,
      n: count,
      batch: true,
      enableThinking: resolveQwenEnableThinking(qwenImageSettings(), requested),
    },
    batch: true,
    fanOut: count,
    warnings: mapped.warnings,
    expectedAspect: ratioValue(mapped.ratio),
  }
}
