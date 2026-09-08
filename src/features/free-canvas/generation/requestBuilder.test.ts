import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { IMAGE_SIZE_PRESETS } from './config'
import {
  buildImageToVideoRequest,
  buildTextToImageRequest,
  buildTextToVideoRequest,
  buildVariationRequest,
} from './requestBuilder'

describe('buildTextToImageRequest', () => {
  it('规范提示词、尺寸和生成数量', () => {
    const request = buildTextToImageRequest('  雨夜里的未来城市  ', IMAGE_SIZE_PRESETS[3], 8)

    expect(request).toMatchObject({
      capability: Capability.TextToImage,
      params: {
        prompt: '雨夜里的未来城市',
        size: { width: 1280, height: 720 },
        count: 4,
      },
    })
    expect(request.requestId).toBeTruthy()
  })

  it('拒绝空提示词', () => {
    expect(() => buildTextToImageRequest('   ', IMAGE_SIZE_PRESETS[0], 1)).toThrow('请输入画面描述')
  })
})

describe('buildTextToVideoRequest', () => {
  it('固定生成一段视频并规范时长', () => {
    const request = buildTextToVideoRequest('  镜头缓慢推进森林  ', IMAGE_SIZE_PRESETS[4], 9)

    expect(request).toMatchObject({
      capability: Capability.TextToVideo,
      params: {
        prompt: '镜头缓慢推进森林',
        size: { width: 720, height: 1280 },
        durationSeconds: 5,
        count: 1,
      },
    })
  })
})

describe('派生生成请求', () => {
  const source = { url: 'source.png', width: 1600, height: 900 }

  it('构建默认四张且提示词可选的裂变请求', () => {
    expect(buildVariationRequest(source, '   ', 8)).toMatchObject({
      capability: Capability.Variation,
      params: {
        sourceImageUrl: 'source.png',
        size: { width: 1600, height: 900 },
        count: 4,
      },
    })
    expect(buildVariationRequest(source, '  更柔和的光线  ', 2).params).toMatchObject({
      prompt: '更柔和的光线',
      count: 2,
    })
  })

  it('构建复用文生视频能力的图生视频请求', () => {
    expect(buildImageToVideoRequest(source, '  镜头缓慢推进  ', 10)).toMatchObject({
      capability: Capability.TextToVideo,
      params: {
        sourceImageUrl: 'source.png',
        prompt: '镜头缓慢推进',
        size: { width: 1600, height: 900 },
        durationSeconds: 10,
        count: 1,
      },
    })
  })

  it('拒绝没有动态描述的图生视频请求', () => {
    expect(() => buildImageToVideoRequest(source, '  ', 5)).toThrow('请输入动态描述')
  })
})
