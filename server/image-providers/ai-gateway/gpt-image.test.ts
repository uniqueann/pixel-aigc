import { describe, expect, it } from 'vitest'
import { GPT_IMAGE_26_MODEL } from '../../../shared/image-models.js'
import type { NormalizedImageRequest } from '../../../shared/image-generation.js'
import {
  GPT_IMAGE_QUALITY,
  buildGptImageRequest,
  fitGptImageSize,
  gptImageOutputTokens,
  gptImageTokenCost,
  isAllowedGptImageSize,
  mapGptImageRequest,
} from './gpt-image.js'

function request(
  width: number,
  height: number,
  resolution: '1k' | '2k' | '4k',
  count = 1,
  images: NormalizedImageRequest['images'] = [],
): NormalizedImageRequest {
  return {
    operation: images.length ? 'image_edit' : 'text_to_image',
    prompt: '橙色香水瓶',
    images,
    target: { size: { width, height }, resolution },
    count,
  }
}

describe('GPT Image 2.6 尺寸与请求', () => {
  it('把 1K/2K/4K 和比例映射成 16 的倍数，质量固定 medium', () => {
    expect(fitGptImageSize(1024, 1024, '1k')).toEqual({ width: 1024, height: 1024, size: '1024x1024' })
    expect(fitGptImageSize(1280, 720, '1k')).toEqual({ width: 1088, height: 608, size: '1088x608' })
    expect(fitGptImageSize(1280, 720, '2k')).toEqual({ width: 2048, height: 1152, size: '2048x1152' })
    expect(fitGptImageSize(1024, 1024, '4k')).toEqual({ width: 2880, height: 2880, size: '2880x2880' })
    expect(fitGptImageSize(1920, 1080, '4k')).toEqual({ width: 3840, height: 2160, size: '3840x2160' })
    expect(fitGptImageSize(4096, 4096, '4k').size).toBe('2880x2880')
    const extreme = fitGptImageSize(100, 800, '2k')
    expect(Math.max(extreme.width, extreme.height) / Math.min(extreme.width, extreme.height)).toBeLessThanOrEqual(3)
    expect(isAllowedGptImageSize(extreme.size)).toBe(true)
    expect(isAllowedGptImageSize('1024x576')).toBe(false)
    expect(isAllowedGptImageSize('4096x4096')).toBe(false)
    expect(isAllowedGptImageSize('auto')).toBe(false)

    const mapped = mapGptImageRequest(request(1024, 1024, '1k', 3))
    expect(mapped.fanOut).toBe(3)
    expect(mapped.providerParams).toMatchObject({
      model: GPT_IMAGE_26_MODEL,
      size: '1024x1024',
      resolution: '1k',
      quality: GPT_IMAGE_QUALITY,
      n: 1,
    })
    expect(mapped.warnings).toEqual([])
  })

  it('文生图走 generations，参考图走 edits，都不走 chat completions', () => {
    const text = buildGptImageRequest({
      model: GPT_IMAGE_26_MODEL,
      prompt: '橙色香水瓶',
      images: [],
      size: '1024x1024',
    })
    expect(text.path).toBe('images/generations')
    expect(text.body).toEqual({
      model: GPT_IMAGE_26_MODEL,
      prompt: '橙色香水瓶',
      size: '1024x1024',
      quality: 'medium',
      n: 1,
      response_format: 'b64_json',
    })
    expect(text.body).not.toHaveProperty('messages')
    expect(text.body).not.toHaveProperty('modalities')
    expect(text.body).not.toHaveProperty('providerOptions')

    const edit = buildGptImageRequest({
      model: GPT_IMAGE_26_MODEL,
      prompt: '换成白底',
      images: [{ url: 'https://r2.test/a.png' }, { url: 'https://r2.test/b.png' }],
      size: '2048x1152',
    })
    expect(edit.path).toBe('images/edits')
    expect(edit.body).toMatchObject({
      quality: 'medium',
      images: [{ image_url: 'https://r2.test/a.png' }, { image_url: 'https://r2.test/b.png' }],
    })
    expect(mapGptImageRequest(request(1200, 800, '2k', 1, [{
      source: { kind: 'r2', objectKey: 'temporary/task-inputs/user/a.png' },
      width: 1200,
      height: 800,
    }])).providerParams.size).toBe('2048x1360')
  })

  it('用公开公式估计 medium 正方形输出成本，缺金额时按 token 还原', () => {
    expect(gptImageOutputTokens(1024, 1024)).toBe(1449)
    expect(gptImageOutputTokens(2048, 2048)).toBe(2944)
    expect(gptImageOutputTokens(2880, 2880)).toBe(4894)
    expect((gptImageOutputTokens(1024, 1024) * 0.00003).toFixed(6)).toBe('0.043470')
    expect((gptImageOutputTokens(2048, 2048) * 0.00003).toFixed(6)).toBe('0.088320')
    expect((gptImageOutputTokens(2880, 2880) * 0.00003).toFixed(6)).toBe('0.146820')
    expect(gptImageTokenCost({ promptTokens: 20, completionTokens: 1449 })).toBe(0.04357)
    expect(gptImageTokenCost({})).toBeUndefined()
  })
})
