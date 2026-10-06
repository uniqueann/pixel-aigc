import { describe, expect, it } from 'vitest'
import { RESOLUTION_DOWNGRADED_4K } from '../../../shared/image-models.js'
import {
  QWEN_IMAGE_RATIOS,
  QWEN_IMAGE_SIZES,
  QWEN_MAX_PIXELS,
  QWEN_MIN_PIXELS,
  mapQwenImageRequest,
  parseQwenSize,
  qwenOutputTier,
} from './mapping.js'

const presets: Array<[string, number, number]> = [
  ['1:1', 1024, 1024],
  ['4:3', 1024, 768],
  ['3:4', 768, 1024],
  ['16:9', 1280, 720],
  ['9:16', 720, 1280],
]

describe('qwen image 尺寸映射', () => {
  it('五种比例的 1K/2K 都在官方像素范围内，并且计费档和请求档一致', () => {
    for (const ratio of QWEN_IMAGE_RATIOS) {
      for (const tier of ['1k', '2k'] as const) {
        const size = QWEN_IMAGE_SIZES[ratio][tier]
        const parsed = parseQwenSize(size)
        expect(parsed, size).toBeTruthy()
        const pixels = parsed!.width * parsed!.height
        expect(pixels).toBeGreaterThanOrEqual(QWEN_MIN_PIXELS)
        expect(pixels).toBeLessThanOrEqual(QWEN_MAX_PIXELS)
        expect(parsed!.width % 16).toBe(0)
        expect(parsed!.height % 16).toBe(0)
        expect(qwenOutputTier(parsed!.width, parsed!.height)).toBe(tier)
      }
    }
  })

  it('画布预设映射到批量 n，而不是按张扇出', () => {
    for (const [ratio, width, height] of presets) {
      for (const resolution of ['1k', '2k'] as const) {
        const mapped = mapQwenImageRequest({
          operation: 'text_to_image',
          prompt: '海报',
          images: [],
          target: { size: { width, height }, resolution },
          count: 4,
        }, 'qwen-image-3.0')
        expect(mapped).toMatchObject({
          batch: true,
          fanOut: 4,
          warnings: [],
          providerParams: {
            model: 'qwen-image-3.0',
            size: QWEN_IMAGE_SIZES[ratio as typeof QWEN_IMAGE_RATIOS[number]][resolution],
            resolution,
            n: 4,
            batch: true,
          },
        })
      }
    }
  })

  it('数量限制在 1 到 4，4K 请求降到 2K 像素', () => {
    const low = mapQwenImageRequest({
      operation: 'text_to_image', prompt: 'x', images: [],
      target: { size: { width: 1024, height: 1024 }, resolution: '1k' }, count: 0,
    }, 'qwen-image-3.0')
    expect(low.fanOut).toBe(1)
    const high = mapQwenImageRequest({
      operation: 'text_to_image', prompt: 'x', images: [],
      target: { aspectRatio: '1:1', resolution: '4k' }, count: 6,
    }, 'qwen-image-3.0-pro')
    expect(high.fanOut).toBe(4)
    expect(high.providerParams).toMatchObject({ size: '2048*2048', resolution: '2k', n: 4 })
    expect(high.warnings).toEqual([RESOLUTION_DOWNGRADED_4K])
  })
})
