import { describe, expect, it } from 'vitest'
import { defaultImageModel, publicImageModel } from '@shared/image-models'
import { availableTextToImagePresets, resolveCanvasTextToImageParameters } from './textToImageParameters'

const original = publicImageModel(defaultImageModel('text_to_image')!)
const draft = { presetKey: '1:1', count: 1 }

describe('自由画布文生图有效参数', () => {
  it('旧草稿读取个人默认分辨率，并优先后端默认模型', () => {
    const first = { ...original, id: 'first', defaultFor: [] }
    const preferred = { ...original, id: 'preferred', defaultFor: ['text_to_image' as const] }
    const result = resolveCanvasTextToImageParameters(draft, '2k', [first, preferred])
    expect(result.model?.id).toBe('preferred')
    expect(result).toMatchObject({ count: 1, resolution: '2k', requestedResolution: '2k', estimatedCredits: 3 })
    expect(draft).not.toHaveProperty('resolution')
  })

  it('已有草稿模型和分辨率优先于个人偏好，模型消失时选择首个可用模型', () => {
    const first = { ...original, id: 'first', defaultFor: [] }
    const chosen = { ...original, id: 'chosen', defaultFor: [] }
    expect(resolveCanvasTextToImageParameters({ ...draft, modelProfileId: 'chosen', resolution: '1k' }, '2k', [first, chosen])).toMatchObject({ model: { id: 'chosen' }, resolution: '1k', estimatedCredits: 2 })
    expect(resolveCanvasTextToImageParameters({ ...draft, modelProfileId: 'removed' }, '2k', [first, chosen]).model?.id).toBe('first')
  })

  it('四千分辨率不支持正方形时显示二千的参数和费用，保留草稿期望值', () => {
    const requested = { ...draft, count: 2, resolution: '4k' as const }
    expect(resolveCanvasTextToImageParameters(requested, '1k', [original])).toMatchObject({
      count: 2, resolution: '2k', requestedResolution: '4k', resolutionAdjusted: true, estimatedCredits: 6,
    })
    expect(requested.resolution).toBe('4k')
    expect(resolveCanvasTextToImageParameters({ ...requested, presetKey: '16:9' }, '1k', [original])).toMatchObject({
      resolution: '4k', resolutionAdjusted: false, estimatedCredits: 10,
    })
  })

  it('模型的数量、分辨率和比例限制统一用于展示与请求', () => {
    const limited = { ...original, ui: { ...original.ui, maxCount: 2, resolutions: ['1k' as const], ratios: ['16:9', '9:16'] } }
    expect(availableTextToImagePresets(limited).map(item => item.key)).toEqual(['16:9', '9:16'])
    expect(resolveCanvasTextToImageParameters({ ...draft, count: 4, resolution: '2k' }, '2k', [limited])).toMatchObject({
      preset: { key: '16:9' }, count: 2, countAdjusted: true, ratioAdjusted: true,
      resolution: '1k', resolutionAdjusted: true, estimatedCredits: 4,
    })
  })

  it('接口数量上限仍为四张，缺失配置时不会虚构积分报价', () => {
    const large = { ...original, ui: { ...original.ui, maxCount: 8 } }
    expect(resolveCanvasTextToImageParameters({ ...draft, count: 8 }, '2k', [large]).count).toBe(4)
    expect(resolveCanvasTextToImageParameters(draft, '2k', [])).toMatchObject({ model: undefined, pricingReady: false, estimatedCredits: undefined })
    expect(availableTextToImagePresets().length).toBe(5)
  })

  it('缺失或异常的有效分辨率报价不能伪装成零积分', () => {
    const missing = { ...original, pricing: { ...original.pricing, creditsPerImage: { '1k': 2 } } }
    expect(resolveCanvasTextToImageParameters(draft, '2k', [missing])).toMatchObject({ pricingReady: false, estimatedCredits: undefined })
    const invalid = { ...original, pricing: { ...original.pricing, creditsPerImage: { '2k': Number.NaN } } }
    expect(resolveCanvasTextToImageParameters(draft, '2k', [invalid])).toMatchObject({ pricingReady: false, estimatedCredits: undefined })
  })
})
