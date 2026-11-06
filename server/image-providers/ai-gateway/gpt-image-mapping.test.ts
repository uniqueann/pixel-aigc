import { describe, expect, it } from 'vitest'
import { DRAGONCODE_RATIOS } from '../../../shared/image-models.js'
import {
  GPT_IMAGE_MAX_EDGE,
  GPT_IMAGE_MAX_PIXELS,
  GPT_IMAGE_MAX_RATIO,
  GPT_IMAGE_MIN_PIXELS,
  GPT_IMAGE_RATIOS,
  buildGptImageApiRequest,
  gptImagePixelSize,
  isGptImagePixelSize,
  mapGptImageRequest,
} from './gpt-image-mapping.js'

const text = (width: number, height: number, resolution: '1k' | '2k' | '4k', count = 1) => ({
  operation: 'text_to_image' as const,
  prompt: '橙色香水瓶',
  images: [],
  target: { size: { width, height }, resolution },
  count,
})

describe('GPT Image 2.6 尺寸映射', () => {
  it('1K/2K/4K 的正方形和 16:9 落到文档里的合法像素', () => {
    expect(gptImagePixelSize('1:1', '1k')).toEqual({ width: 1024, height: 1024 })
    expect(gptImagePixelSize('1:1', '2k')).toEqual({ width: 2048, height: 2048 })
    expect(gptImagePixelSize('1:1', '4k')).toEqual({ width: 2880, height: 2880 })
    expect(gptImagePixelSize('16:9', '2k')).toEqual({ width: 2048, height: 1152 })
    expect(gptImagePixelSize('16:9', '4k')).toEqual({ width: 3840, height: 2160 })
    expect(gptImagePixelSize('9:16', '4k')).toEqual({ width: 2160, height: 3840 })
  })

  it('每个目录比例在三档分辨率上都满足 16 整除、比例和像素上限', () => {
    expect(GPT_IMAGE_RATIOS).toEqual([...DRAGONCODE_RATIOS])
    expect(GPT_IMAGE_RATIOS).not.toContain('auto')
    for (const ratio of GPT_IMAGE_RATIOS) {
      for (const resolution of ['1k', '2k', '4k'] as const) {
        const sized = gptImagePixelSize(ratio, resolution)
        const size = `${sized.width}x${sized.height}`
        expect(isGptImagePixelSize(size), size).toBe(true)
        expect(sized.width % 16).toBe(0)
        expect(sized.height % 16).toBe(0)
        expect(Math.max(sized.width, sized.height)).toBeLessThanOrEqual(GPT_IMAGE_MAX_EDGE)
        const pixels = sized.width * sized.height
        expect(pixels).toBeGreaterThanOrEqual(GPT_IMAGE_MIN_PIXELS)
        expect(pixels).toBeLessThanOrEqual(GPT_IMAGE_MAX_PIXELS)
        expect(Math.max(sized.width, sized.height) / Math.min(sized.width, sized.height)).toBeLessThanOrEqual(GPT_IMAGE_MAX_RATIO + 1e-9)
        const [width, height] = ratio.split(':').map(Number)
        expect(Math.abs(Math.log(sized.width / sized.height) - Math.log(width / height))).toBeLessThan(0.03)
      }
    }
  })

  it('文生图请求写成 WIDTHxHEIGHT，quality 固定 medium', () => {
    const mapped = mapGptImageRequest(text(1024, 1024, '1k', 2))
    expect(mapped).toMatchObject({
      fanOut: 2,
      warnings: [],
      providerParams: {
        model: 'openai/gpt-image-2.6-flare',
        size: '1024x1024',
        quality: 'medium',
        resolution: '1k',
        aspectRatio: '1:1',
        n: 1,
      },
    })
    expect(mapped.providerParams).not.toHaveProperty('imageSize')
    expect(mapped.providerParams).not.toHaveProperty('providerOptions')
    const body = buildGptImageApiRequest({
      model: 'openai/gpt-image-2.6-flare',
      prompt: '橙色香水瓶',
      size: '1024x1024',
      images: [],
    })
    expect(body.endpoint).toBe('images/generations')
    expect(body.body).toEqual({
      model: 'openai/gpt-image-2.6-flare',
      prompt: '橙色香水瓶',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
    })
    expect(body.body).not.toHaveProperty('images')
    expect(body.body).not.toHaveProperty('modalities')
  })

  it('有参考图时走 edits，最多按请求带上全部图片地址', () => {
    const mapped = mapGptImageRequest({
      operation: 'image_edit',
      prompt: '换成白底',
      images: [{ source: { kind: 'r2' as const, objectKey: 'temporary/task-inputs/source' }, width: 1200, height: 800 }],
      target: { resolution: '2k' },
      count: 1,
    })
    expect(mapped.providerParams).toMatchObject({
      size: '2048x1360',
      quality: 'medium',
      resolution: '2k',
      aspectRatio: '3:2',
    })
    const urls = Array.from({ length: 16 }, (_, index) => ({ url: `https://r2.test/${index}.png` }))
    const body = buildGptImageApiRequest({
      model: 'openai/gpt-image-2.6-flare',
      prompt: '换成白底',
      size: '2048x1360',
      images: urls,
    })
    expect(body.endpoint).toBe('images/edits')
    expect(body.body.images).toHaveLength(16)
    expect(body.body.images?.[0]).toEqual({ image_url: 'https://r2.test/0.png' })
    expect(body.body.quality).toBe('medium')
    expect(JSON.stringify(body)).not.toContain('chat/completions')
    expect(JSON.stringify(body)).not.toContain('providerOptions')
  })
})
