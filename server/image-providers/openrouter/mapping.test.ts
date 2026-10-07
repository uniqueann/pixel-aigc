import { describe, expect, it } from 'vitest'
import { buildOpenRouterChatBody, mapOpenRouterImageRequest, OPENROUTER_IMAGE_RATIOS } from './mapping.js'

const text = (width: number, height: number, resolution: '1k' | '2k' | '4k', count = 1) => ({
  operation: 'text_to_image' as const,
  prompt: '橙色香水瓶',
  images: [],
  target: { size: { width, height }, resolution },
  count,
})

describe('OpenRouter 图片请求', () => {
  it('把分辨率和比例写成 image_config，多张只扇出、不在单次请求里加 n', () => {
    expect(OPENROUTER_IMAGE_RATIOS).toEqual([
      '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
      '1:4', '4:1', '1:8', '8:1', '9:16', '16:9', '21:9', '9:21',
    ])
    const mapped = mapOpenRouterImageRequest(text(1280, 720, '2k', 3))
    expect(mapped).not.toHaveProperty('batch')
    expect(mapped).toMatchObject({
      fanOut: 3,
      warnings: [],
      providerParams: {
        model: 'google/gemini-nano-banana-2.1',
        aspectRatio: '16:9',
        imageSize: '2K',
        resolution: '2k',
        n: 1,
      },
    })
    expect(mapOpenRouterImageRequest(text(1024, 1024, '1k')).providerParams.imageSize).toBe('1K')
    expect(mapOpenRouterImageRequest(text(1024, 1024, '4k')).providerParams).toMatchObject({
      aspectRatio: '1:1',
      imageSize: '4K',
      resolution: '4k',
    })
    expect(mapOpenRouterImageRequest(text(768, 1024, '4k')).providerParams.aspectRatio).toBe('3:4')
    expect(mapOpenRouterImageRequest(text(720, 1280, '1k')).providerParams.aspectRatio).toBe('9:16')
  })

  it('参考图不改变张数和分辨率，请求体只带 modalities 与 image_config', () => {
    const mapped = mapOpenRouterImageRequest({
      operation: 'image_edit',
      prompt: '换成白底',
      images: [{ source: { kind: 'r2', objectKey: 'temporary/a' }, width: 1200, height: 800 }],
      target: { resolution: '1k' },
      count: 2,
    })
    expect(mapped.fanOut).toBe(2)
    expect(mapped.providerParams).toMatchObject({ aspectRatio: '3:2', imageSize: '1K', resolution: '1k', n: 1 })
    const body = buildOpenRouterChatBody({
      model: 'google/gemini-nano-banana-2.1',
      prompt: '换成白底',
      images: [{ url: 'https://r2.test/source.png' }],
      aspectRatio: '3:2',
      imageSize: '1K',
    })
    expect(body).toEqual({
      model: 'google/gemini-nano-banana-2.1',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '换成白底' },
          { type: 'image_url', image_url: { url: 'https://r2.test/source.png' } },
        ],
      }],
      modalities: ['image', 'text'],
      image_config: { aspect_ratio: '3:2', image_size: '1K' },
    })
    expect(body).not.toHaveProperty('plugins')
    expect(body).not.toHaveProperty('tools')
    expect(JSON.stringify(body)).not.toContain('web_search')
  })
})
