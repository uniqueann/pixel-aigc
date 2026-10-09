import type { ImageOperation, ImageResolution } from './image-generation.js'
import { PROMPT_MAX_LENGTH } from './prompt-limits.js'

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

export const OPENROUTER_NANO_BANANA_PROFILE_ID = 'openrouter:gemini-nano-banana-2.1'
export const OPENROUTER_NANO_BANANA_MODEL = 'google/gemini-nano-banana-2.1'

/** 模型厂商。dragoncode / bailian / openrouter / ai-gateway 是接入渠道，不是厂商。 */
export const IMAGE_MODEL_VENDORS = ['openai', 'qwen', 'google', 'deepseek'] as const
export type ImageModelVendor = typeof IMAGE_MODEL_VENDORS[number]

/** 文生图、多图工具、单图工具可以各写一条。单图工具不要用参考图数量。 */
export type ImageModelHintScope = 'text_to_image' | 'image_input' | 'single_image'

export function isImageModelVendor(value: unknown): value is ImageModelVendor {
  return typeof value === 'string' && (IMAGE_MODEL_VENDORS as readonly string[]).includes(value)
}

export interface ImageModelProfile {
  id: string
  /**
   * `ai-gateway` 只在运行时由模型目录替换出来，静态条目仍写 `openrouter`。
   * `aigc.image_jobs.provider` 是没有检查约束的 text，不需要迁移。
   */
  provider: 'dragoncode' | 'bailian' | 'openrouter' | 'ai-gateway' | 'mock'
  vendor: ImageModelVendor
  model: string
  label: string
  operations: ImageOperation[]
  ui: ImageModelUi
  pricing: {
    unit: 'image'
    creditsPerImage: Partial<Record<ImageResolution, number>>
    vendorCost?: Partial<Record<ImageResolution, string>>
    /**
     * 每张输入图的供应商成本，不计入用户积分。
     * 千问 3.0 / 3.0 Pro 为人民币 0.02；2.1 Pro 输入图不另计。
     */
    vendorInputImageCost?: string
    /** 供应商成本的币种。GPT Image 2 的 vendorCost 历史数据未标币种，千问按人民币记录。 */
    vendorCurrency?: string
  }
  defaultFor?: ImageOperation[]
  /** 下拉选项旁的短标签。只写目录里能核对的事实，不写效果评价。 */
  hints?: Partial<Record<ImageModelHintScope, string>>
  enabled: boolean
}

export const IMAGE_MODEL_PROFILES: ImageModelProfile[] = [
  {
    id: 'dragoncode:gpt-image-2',
    provider: 'dragoncode',
    vendor: 'openai',
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
      promptMaxLength: PROMPT_MAX_LENGTH,
    },
    pricing: {
      unit: 'image',
      creditsPerImage: { '1k': 4, '2k': 6, '4k': 14 },
      vendorCost: { '1k': '0.0085', '2k': '0.014', '4k': '0.021' },
    },
    defaultFor: ['image_edit', 'variation'],
    hints: { text_to_image: '支持 4K', image_input: '支持 4K', single_image: '支持 4K' },
    enabled: true,
  },
  // 开关关闭时不要把 enabled 改成 true：积分说明和本地 Mock 只看这个字段。
  // 服务端在 QWEN_IMAGE_ENABLED=true 且已配置百炼 Key 时才把它们列入 /api/image-models。
  {
    id: 'bailian:qwen-image-3.0',
    provider: 'bailian',
    vendor: 'qwen',
    model: 'qwen-image-3.0',
    label: 'Qwen Image 3.0',
    // 融合不是独立 operation，提交时仍是带第二张参考图的 image_edit。
    operations: ['text_to_image', 'image_edit', 'variation'],
    ui: {
      supportsMask: false,
      maxCount: 4,
      resolutions: ['1k', '2k'],
      sizeMode: 'ratio',
      ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      maxRefImages: 3,
      promptMaxLength: PROMPT_MAX_LENGTH,
    },
    pricing: {
      unit: 'image',
      creditsPerImage: { '1k': 3, '2k': 3 },
      vendorCost: { '1k': '0.18', '2k': '0.18' },
      vendorInputImageCost: '0.02',
      vendorCurrency: 'CNY',
    },
    hints: { text_to_image: '最省积分', image_input: '最省积分', single_image: '最省积分' },
    enabled: false,
  },
  {
    id: 'bailian:qwen-image-3.0-pro',
    provider: 'bailian',
    vendor: 'qwen',
    model: 'qwen-image-3.0-pro',
    label: 'Qwen Image 3.0 Pro',
    operations: ['text_to_image', 'image_edit', 'variation'],
    ui: {
      supportsMask: false,
      maxCount: 4,
      resolutions: ['1k', '2k'],
      sizeMode: 'ratio',
      ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      maxRefImages: 3,
      promptMaxLength: PROMPT_MAX_LENGTH,
    },
    pricing: {
      unit: 'image',
      creditsPerImage: { '1k': 4, '2k': 8 },
      vendorCost: { '1k': '0.25', '2k': '0.50' },
      vendorInputImageCost: '0.02',
      vendorCurrency: 'CNY',
    },
    hints: { text_to_image: '1K 划算', image_input: '1K 划算', single_image: '1K 划算' },
    enabled: false,
  },
  // 与 3.0 共用开关和百炼 Key。输出不按分辨率分档，输入图不另计供应商成本。
  // 不接蒙版，也不接官方的 edit-plus。
  {
    id: 'bailian:qwen-image-2.1-pro',
    provider: 'bailian',
    vendor: 'qwen',
    model: 'qwen-image-2.1-pro',
    label: 'Qwen Image 2.1 Pro',
    operations: ['text_to_image', 'image_edit', 'variation'],
    ui: {
      supportsMask: false,
      maxCount: 4,
      resolutions: ['1k', '2k'],
      sizeMode: 'ratio',
      ratios: ['1:1', '4:3', '3:4', '16:9', '9:16'],
      maxRefImages: 10,
      promptMaxLength: PROMPT_MAX_LENGTH,
    },
    pricing: {
      unit: 'image',
      creditsPerImage: { '1k': 4, '2k': 4 },
      vendorCost: { '1k': '0.25', '2k': '0.25' },
      vendorCurrency: 'CNY',
    },
    // 融合才用参考图上限。单图工具改写 2K 同价，避免重新打光出现用不上的张数。
    hints: { text_to_image: '2K 同价', image_input: '最多 10 张参考图', single_image: '2K 同价' },
    enabled: false,
  },
  // 开关关闭时不要把 enabled 改成 true：积分说明和本地 Mock 只看这个字段。
  // AI_GATEWAY_IMAGE_ENABLED 且有 Gateway 凭证时，服务端把 provider 改成 ai-gateway。
  // 否则仍要 OPENROUTER_IMAGE_ENABLED=true 且已配置 OPENROUTER_API_KEY。
  // 参考图不另加积分，也不开启 web search。
  // vendorCost：1K 来自 AI Gateway 实测 usage.cost 0.0393585（1:1、1K、1024x1024，含推理 token），
  // 按 6 位小数四舍五入。2K、4K 还没有实测，按积分比 6/4、14/4 从该实测值估算。
  {
    id: OPENROUTER_NANO_BANANA_PROFILE_ID,
    provider: 'openrouter',
    vendor: 'google',
    model: OPENROUTER_NANO_BANANA_MODEL,
    label: 'Google Nano Banana 2.1',
    operations: ['text_to_image', 'image_edit', 'variation'],
    ui: {
      supportsMask: false,
      maxCount: 4,
      resolutions: ['1k', '2k', '4k'],
      sizeMode: 'ratio',
      ratios: [
        '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
        '1:4', '4:1', '1:8', '8:1', '9:16', '16:9', '21:9', '9:21',
      ],
      maxRefImages: 14,
      promptMaxLength: PROMPT_MAX_LENGTH,
    },
    pricing: {
      unit: 'image',
      creditsPerImage: { '1k': 4, '2k': 6, '4k': 14 },
      vendorCost: { '1k': '0.039359', '2k': '0.059038', '4k': '0.137755' },
      vendorCurrency: 'USD',
    },
    hints: { text_to_image: '支持 4K', image_input: '支持 4K', single_image: '支持 4K' },
    enabled: false,
  },
]

export function imageModelHint(
  model: { hints?: Partial<Record<ImageModelHintScope, string>> } | undefined,
  scope: ImageModelHintScope,
) {
  const hints = model?.hints
  if (!hints) return undefined
  if (scope === 'single_image') return hints.single_image ?? hints.text_to_image
  if (scope === 'image_input') return hints.image_input ?? hints.text_to_image
  return hints.text_to_image
}

/**
 * 按目录里的 vendor 识别厂商；目录没有该 id 时再按模型 id 本身判断。
 * 不看 provider：同一厂商可以换渠道，未知 id 返回 undefined。
 */
export function referenceImageLimitMessage(max: number) {
  return `当前模型最多 ${max} 张参考图`
}

export function imageModelVendor(id: string | null | undefined): ImageModelVendor | undefined {
  if (!id) return undefined
  const listed = IMAGE_MODEL_PROFILES.find(profile => profile.id === id)
  if (listed) return listed.vendor
  if (id === 'dragoncode:gpt-image-2' || /(?:^|:)gpt-image-2$/.test(id)) return 'openai'
  if (id.startsWith('bailian:qwen-image') || id.startsWith('qwen:')) return 'qwen'
  if (id.includes('gemini-nano-banana')) return 'google'
  return undefined
}

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
    vendor: profile.vendor,
    model: profile.model,
    label: profile.label,
    operations: profile.operations,
    ui: profile.ui,
    defaultFor: profile.defaultFor,
    pricing: { unit: profile.pricing.unit, creditsPerImage: profile.pricing.creditsPerImage },
    hints: profile.hints,
  }
}

export type PublicImageModel = ReturnType<typeof publicImageModel>
