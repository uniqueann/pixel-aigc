import { describe, expect, it } from 'vitest'
import { AI_GATEWAY_IMAGE_RATIOS, buildAiGatewayChatBody, mapAiGatewayImageRequest } from './mapping.js'

const text = (width: number, height: number, resolution: '1k' | '2k' | '4k', count = 1) => ({
  operation: 'text_to_image' as const,
  prompt: '橙色香水瓶',
  images: [],
  target: { size: { width, height }, resolution },
  count,
})

describe('AI Gateway 图片请求', () => {
  it('把分辨率和比例放进 google 与 vertex 的 imageConfig', () => {
    expect(AI_GATEWAY_IMAGE_RATIOS).toEqual([
      '1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4',
      '1:4', '4:1', '1:8', '8:1', '9:16', '16:9', '21:9', '9:21',
    ])
    const mapped = mapAiGatewayImageRequest(text(1024, 1024, '1k', 2))
    expect(mapped).toMatchObject({
      fanOut: 2,
      providerParams: { aspectRatio: '1:1', imageSize: '1K', resolution: '1k', n: 1 },
    })
    const body = buildAiGatewayChatBody({
      model: 'google/gemini-nano-banana-2.1',
      prompt: '橙色香水瓶',
      images: [],
      aspectRatio: '1:1',
      imageSize: '1K',
    })
    expect(body.modalities).toEqual(['text', 'image'])
    expect(body.stream).toBe(false)
    expect(body.providerOptions.google.imageConfig).toEqual({ aspectRatio: '1:1', imageSize: '1K' })
    expect(body.providerOptions.vertex.imageConfig).toEqual({ aspectRatio: '1:1', imageSize: '1K' })
    expect(body.providerOptions.google.imageConfig).not.toBe(body.providerOptions.vertex.imageConfig)
    expect(body).not.toHaveProperty('image_config')
    expect(body).not.toHaveProperty('plugins')
    expect(body).not.toHaveProperty('tools')
    expect(JSON.stringify(body)).not.toContain('web_search')
  })

  it('参考图跟在文本后面，2K 与 4K 保持大写尺寸', () => {
    expect(mapAiGatewayImageRequest(text(1280, 720, '2k')).providerParams).toMatchObject({
      aspectRatio: '16:9', imageSize: '2K',
    })
    expect(mapAiGatewayImageRequest(text(1024, 1024, '4k')).providerParams.imageSize).toBe('4K')
    const body = buildAiGatewayChatBody({
      model: 'google/gemini-nano-banana-2.1',
      prompt: '换成白底',
      images: [{ url: 'https://r2.test/source.png' }],
      aspectRatio: '3:2',
      imageSize: '2K',
    })
    expect(body.messages[0].content).toEqual([
      { type: 'text', text: '换成白底' },
      { type: 'image_url', image_url: { url: 'https://r2.test/source.png' } },
    ])
    expect(body.providerOptions.google.imageConfig).toEqual({ aspectRatio: '3:2', imageSize: '2K' })
    expect(body.providerOptions.vertex.imageConfig).toEqual({ aspectRatio: '3:2', imageSize: '2K' })
  })
})
