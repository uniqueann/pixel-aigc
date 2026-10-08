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
  imageModelHint,
  imageModelVendor,
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
    expect(qwen.map(profile => profile.id)).toEqual([
      'bailian:qwen-image-3.0', 'bailian:qwen-image-3.0-pro', 'bailian:qwen-image-2.1-pro',
    ])
    expect(qwen.map(profile => profile.pricing.creditsPerImage)).toEqual([
      { '1k': 3, '2k': 3 },
      { '1k': 4, '2k': 8 },
      { '1k': 4, '2k': 4 },
    ])
    expect(qwen.map(profile => profile.ui.maxRefImages)).toEqual([3, 3, 10])
    expect(qwen.every(profile => profile.operations.includes('image_edit') && profile.operations.includes('variation'))).toBe(true)
    for (const profile of qwen) {
      expect(profile.enabled).toBe(false)
      expect(profile.ui.promptMaxLength).toBe(PROMPT_MAX_LENGTH)
      expect(profile.ui.resolutions).toEqual(['1k', '2k'])
      expect(publicImageModel(profile).pricing).toEqual({ unit: 'image', creditsPerImage: profile.pricing.creditsPerImage })
      expect(JSON.stringify(publicImageModel(profile))).not.toContain('vendorCost')
      expect(JSON.stringify(publicImageModel(profile))).not.toContain('vendorInputImageCost')
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

  it('GPT Image 2 积分与 Nano Banana 2.1 相同，供应商成本保持原值', () => {
    const gpt = IMAGE_MODEL_PROFILES.find(item => item.id === 'dragoncode:gpt-image-2')
    const nano = IMAGE_MODEL_PROFILES.find(item => item.id === OPENROUTER_NANO_BANANA_PROFILE_ID)
    expect(gpt?.pricing.creditsPerImage).toEqual({ '1k': 4, '2k': 6, '4k': 14 })
    expect(gpt?.pricing.creditsPerImage).toEqual(nano?.pricing.creditsPerImage)
    expect(gpt?.pricing.vendorCost).toEqual({ '1k': '0.0085', '2k': '0.014', '4k': '0.021' })
    expect(gpt?.pricing.vendorCurrency).toBeUndefined()
    expect(publicImageModel(gpt!).pricing).toEqual({ unit: 'image', creditsPerImage: { '1k': 4, '2k': 6, '4k': 14 } })
    expect(JSON.stringify(publicImageModel(gpt!))).not.toContain('vendorCost')
  })

  it('按厂商而不是接入渠道给出图标标识', () => {
    expect(IMAGE_MODEL_PROFILES.map(profile => [profile.id, profile.vendor])).toEqual([
      ['dragoncode:gpt-image-2', 'openai'],
      ['bailian:qwen-image-3.0', 'qwen'],
      ['bailian:qwen-image-3.0-pro', 'qwen'],
      ['bailian:qwen-image-2.1-pro', 'qwen'],
      [OPENROUTER_NANO_BANANA_PROFILE_ID, 'google'],
    ])
    for (const profile of IMAGE_MODEL_PROFILES) {
      expect(publicImageModel(profile).vendor).toBe(profile.vendor)
      expect(imageModelVendor(profile.id)).toBe(profile.vendor)
    }
    expect(imageModelVendor('ai-gateway:google/gemini-nano-banana-2.1')).toBe('google')
    expect(imageModelVendor('dragoncode:not-a-model')).toBeUndefined()
    expect(imageModelVendor('ai-gateway:some-other')).toBeUndefined()
    expect(imageModelVendor('deepseek:用户默认模型')).toBeUndefined()
    expect(imageModelVendor('')).toBeUndefined()
    expect(imageModelVendor(undefined)).toBeUndefined()
  })

  it('下拉短标签只写目录里能核对的事实，并按工具区分', () => {
    const hint = (id: string, scope: 'text_to_image' | 'image_input' | 'single_image') => {
      const profile = IMAGE_MODEL_PROFILES.find(item => item.id === id)
      return imageModelHint(publicImageModel(profile!), scope)
    }
    expect(hint('dragoncode:gpt-image-2', 'text_to_image')).toBe('支持 4K')
    expect(hint('dragoncode:gpt-image-2', 'image_input')).toBe('支持 4K')
    expect(hint('dragoncode:gpt-image-2', 'single_image')).toBe('支持 4K')
    expect(hint('bailian:qwen-image-3.0', 'text_to_image')).toBe('最省积分')
    expect(hint('bailian:qwen-image-3.0', 'image_input')).toBe('最省积分')
    expect(hint('bailian:qwen-image-3.0', 'single_image')).toBe('最省积分')
    expect(hint('bailian:qwen-image-3.0-pro', 'text_to_image')).toBe('分辨率加价')
    expect(hint('bailian:qwen-image-3.0-pro', 'single_image')).toBe('分辨率加价')
    expect(hint('bailian:qwen-image-2.1-pro', 'text_to_image')).toBe('2K 同价')
    expect(hint('bailian:qwen-image-2.1-pro', 'single_image')).toBe('2K 同价')
    expect(hint('bailian:qwen-image-2.1-pro', 'image_input')).toBe('最多 10 张参考图')
    expect(hint(OPENROUTER_NANO_BANANA_PROFILE_ID, 'text_to_image')).toBe('支持 4K')
    expect(hint(OPENROUTER_NANO_BANANA_PROFILE_ID, 'image_input')).toBe('支持 4K')
    for (const profile of IMAGE_MODEL_PROFILES) {
      for (const text of Object.values(profile.hints ?? {})) {
        const chinese = [...text].filter(char => /\p{Script=Han}/u.test(char)).length
        expect(chinese).toBeGreaterThanOrEqual(2)
        expect(chinese).toBeLessThanOrEqual(8)
      }
    }
    expect(imageModelHint(undefined, 'text_to_image')).toBeUndefined()
    expect(imageModelHint({ hints: { text_to_image: '支持 4K' } }, 'single_image')).toBe('支持 4K')
    expect(imageModelHint({ hints: { text_to_image: '支持 4K' } }, 'image_input')).toBe('支持 4K')
  })
})
