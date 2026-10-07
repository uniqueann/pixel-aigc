import { describe, expect, it } from 'vitest'
import { PROMPT_MAX_LENGTH } from './prompt-limits'
import {
  DRAGONCODE_RATIOS,
  DRAGONCODE_SIZES,
  IMAGE_MODEL_PROFILES,
  OPENROUTER_NANO_BANANA_MODEL,
  OPENROUTER_NANO_BANANA_PROFILE_ID,
  RESOLUTION_DOWNGRADED_4K,
  defaultImageModel,
  mapDragonCodeSize,
  nearestRatio,
  publicImageModel,
} from './image-models'

const exact: Array<[number, number, string]> = [
  [1000, 1000, '1:1'],
  [3000, 2000, '3:2'],
  [2000, 3000, '2:3'],
  [4000, 3000, '4:3'],
  [3000, 4000, '3:4'],
  [5000, 4000, '5:4'],
  [4000, 5000, '4:5'],
  [1600, 900, '16:9'],
  [900, 1600, '9:16'],
  [2000, 1000, '2:1'],
  [1000, 2000, '1:2'],
  [2100, 900, '21:9'],
  [900, 2100, '9:21'],
]

describe('nearestRatio / mapDragonCodeSize', () => {
  it('精确命中全部官方比例', () => {
    for (const [width, height, ratio] of exact) {
      expect(nearestRatio(width, height)).toBe(ratio)
      expect(mapDragonCodeSize(width, height, '2k')).toEqual({ size: ratio, resolution: '2k', warnings: [] })
      expect(mapDragonCodeSize(width, height, '1k')).toEqual({ size: ratio, resolution: '1k', warnings: [] })
    }
  })

  it('把常见商品图映射到最近比例', () => {
    expect(nearestRatio(1200, 800)).toBe('3:2')
    expect(nearestRatio(1600, 1200)).toBe('4:3')
    expect(nearestRatio(1080, 1920)).toBe('9:16')
    expect(nearestRatio(5000, 1000)).toBe('21:9')
  })

  it('4k 仅在支持的宽比例上保留，否则降为 2k', () => {
    expect(mapDragonCodeSize(1080, 1920, '4k')).toEqual({ size: '9:16', resolution: '4k', warnings: [] })
    expect(mapDragonCodeSize(1920, 1080, '4k')).toEqual({ size: '16:9', resolution: '4k', warnings: [] })
    expect(mapDragonCodeSize(1000, 1000, '4k')).toEqual({
      size: '1:1', resolution: '2k', warnings: [RESOLUTION_DOWNGRADED_4K],
    })
    expect(mapDragonCodeSize(1200, 800, '4k')).toEqual({
      size: '3:2', resolution: '2k', warnings: [RESOLUTION_DOWNGRADED_4K],
    })
  })

  it('可限制候选比例集合', () => {
    expect(nearestRatio(1000, 1000, ['16:9', '9:16'])).toBe('16:9')
    expect(DRAGONCODE_RATIOS).toHaveLength(13)
    expect(defaultImageModel('text_to_image')?.id).toBe('dragoncode:gpt-image-2')
    const qwen = IMAGE_MODEL_PROFILES.filter(profile => profile.provider === 'bailian')
    expect(qwen.map(profile => profile.id)).toEqual(['bailian:qwen-image-3.0', 'bailian:qwen-image-3.0-pro'])
    expect(qwen.map(profile => profile.pricing.creditsPerImage)).toEqual([
      { '1k': 3, '2k': 3 },
      { '1k': 4, '2k': 8 },
    ])
    for (const profile of qwen) {
      expect(profile.enabled).toBe(false)
      expect(profile.ui.promptMaxLength).toBe(PROMPT_MAX_LENGTH)
      expect(profile.ui.resolutions).toEqual(['1k', '2k'])
      expect(publicImageModel(profile).pricing).toEqual({ unit: 'image', creditsPerImage: profile.pricing.creditsPerImage })
      expect(JSON.stringify(publicImageModel(profile))).not.toContain('vendorCost')
    }
    expect(DRAGONCODE_SIZES).toEqual([
      'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
      '16:9', '9:16', '2:1', '1:2', '21:9', '9:21',
    ])
  })

  it('Nano Banana 2.1 按 1K/2K/4K 报价，公开接口不含供应商成本', () => {
    const profile = IMAGE_MODEL_PROFILES.find(item => item.id === OPENROUTER_NANO_BANANA_PROFILE_ID)
    expect(profile).toMatchObject({
      provider: 'openrouter',
      model: OPENROUTER_NANO_BANANA_MODEL,
      label: 'Google Nano Banana 2.1',
      enabled: false,
      operations: ['text_to_image', 'image_edit', 'variation'],
      pricing: {
        unit: 'image',
        creditsPerImage: { '1k': 4, '2k': 6, '4k': 14 },
        vendorCost: { '1k': '0.039359', '2k': '0.059038', '4k': '0.137755' },
        vendorCurrency: 'USD',
      },
    })
    expect(profile?.ui.resolutions).toEqual(['1k', '2k', '4k'])
    expect(profile?.ui.maxRefImages).toBe(14)
    expect(profile?.ui.resolutionRatioConstraints).toBeUndefined()
    const published = publicImageModel(profile!)
    expect(published.pricing).toEqual({ unit: 'image', creditsPerImage: { '1k': 4, '2k': 6, '4k': 14 } })
    expect(JSON.stringify(published)).not.toContain('vendorCost')
    expect(JSON.stringify(published)).not.toContain('0.039359')
    expect(defaultImageModel('text_to_image')?.id).toBe('dragoncode:gpt-image-2')
  })
})
