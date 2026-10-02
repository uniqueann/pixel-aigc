import type { ImageOperation, ImageResolution } from './image-generation.js'

export const DRAGONCODE_RATIOS = [
  '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
  '16:9', '9:16', '2:1', '1:2', '21:9', '9:21',
] as const

/** DragonCode 实测接受的 size 值，含 auto。nearest-ratio 映射仍只用 DRAGONCODE_RATIOS。 */
export const DRAGONCODE_SIZES = ['auto', ...DRAGONCODE_RATIOS] as const

export const DRAGONCODE_FOUR_K_RATIOS = ['16:9', '9:16', '2:1', '1:2', '21:9', '9:21'] as const

export const DRAGONCODE_MAX_INPUT_BYTES = 20_971_520

export const RESOLUTION_DOWNGRADED_4K = 'RESOLUTION_DOWNGRADED_4K_UNSUPPORTED_RATIO'

export type DragonCodeRatio = typeof DRAGONCODE_RATIOS[number]
export type SizeMode = 'pixel' | 'ratio'

export interface ImageModelUi {
  supportsMask: boolean
  maxCount: number
  resolutions: ImageResolution[]
  sizeMode: SizeMode
  ratios?: string[]
  resolutionRatioConstraints?: Partial<Record<ImageResolution, string[]>>
  maxRefImages: number
  promptMaxLength?: number
}

export interface ImageModelProfile {
  id: string
  provider: 'dragoncode' | 'bailian' | 'mock'
  model: string
  label: string
  operations: ImageOperation[]
  ui: ImageModelUi
  pricing: {
    unit: 'image'
    creditsPerImage: Partial<Record<ImageResolution, number>>
    vendorCost?: Partial<Record<ImageResolution, string>>
  }
  defaultFor?: ImageOperation[]
  enabled: boolean
}

export const IMAGE_MODEL_PROFILES: ImageModelProfile[] = [
  {
    id: 'dragoncode:gpt-image-2',
    provider: 'dragoncode',
    model: 'gpt-image-2',
    label: 'GPT Image 2',
    operations: ['image_edit', 'text_to_image', 'variation'],
    ui: {
      supportsMask: false,
      maxCount: 4,
      resolutions: ['1k', '2k', '4k'],
      sizeMode: 'ratio',
      ratios: [...DRAGONCODE_SIZES],
      resolutionRatioConstraints: { '4k': [...DRAGONCODE_FOUR_K_RATIOS] },
      maxRefImages: 16,
      promptMaxLength: 4000,
    },
    pricing: {
      unit: 'image',
      creditsPerImage: { '1k': 2, '2k': 3, '4k': 5 },
      vendorCost: { '1k': '0.0085', '2k': '0.014', '4k': '0.021' },
    },
    defaultFor: ['image_edit', 'variation'],
    enabled: true,
  },
]

export function findImageModel(id: string) {
  return IMAGE_MODEL_PROFILES.find(profile => profile.id === id)
}

export function defaultImageModel(operation: ImageOperation) {
  return IMAGE_MODEL_PROFILES.find(profile => profile.enabled && profile.defaultFor?.includes(operation))
    ?? IMAGE_MODEL_PROFILES.find(profile => profile.enabled && profile.operations.includes(operation))
}

export function ratioValue(ratio: string) {
  const [width, height] = ratio.split(':').map(Number)
  if (!width || !height) return 1
  return width / height
}

export function nearestRatio(width: number, height: number, allowed: readonly string[] = DRAGONCODE_RATIOS) {
  const safeWidth = Math.max(1, width)
  const safeHeight = Math.max(1, height)
  const target = Math.log(safeWidth / safeHeight)
  return allowed.reduce((best, ratio) => {
    const better = Math.abs(Math.log(ratioValue(ratio)) - target) < Math.abs(Math.log(ratioValue(best)) - target)
    return better ? ratio : best
  })
}

export function mapDragonCodeSize(
  width: number,
  height: number,
  resolution: ImageResolution,
  allowed: readonly string[] = DRAGONCODE_RATIOS,
) {
  const size = nearestRatio(width, height, allowed)
  if (resolution !== '4k') return { size, resolution, warnings: [] as string[] }
  if ((DRAGONCODE_FOUR_K_RATIOS as readonly string[]).includes(size)) {
    return { size, resolution, warnings: [] as string[] }
  }
  return { size, resolution: '2k' as const, warnings: [RESOLUTION_DOWNGRADED_4K] }
}

export function publicImageModel(profile: ImageModelProfile) {
  return {
    id: profile.id,
    provider: profile.provider,
    model: profile.model,
    label: profile.label,
    operations: profile.operations,
    ui: profile.ui,
    defaultFor: profile.defaultFor,
    pricing: { unit: profile.pricing.unit, creditsPerImage: profile.pricing.creditsPerImage },
  }
}

export type PublicImageModel = ReturnType<typeof publicImageModel>
