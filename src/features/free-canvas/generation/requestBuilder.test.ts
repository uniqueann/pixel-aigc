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

  it('真实文生图按分辨率缩放长边并记录模型，不附带源图片参数', () => {
    const request = buildTextToImageRequest('纵向森林', IMAGE_SIZE_PRESETS[4], 2, { resolution: '2k', modelProfileId: 'chosen-model' })
    expect(request).toMatchObject({ modelProfileId: 'chosen-model', params: {
      prompt: '纵向森林', size: { width: 1152, height: 2048 }, count: 2, resolution: '2k',
    } })
    expect(request.params).not.toHaveProperty('sourceImageUrl')
    expect(request.params).not.toHaveProperty('sourceWidth')
    expect(request.params).not.toHaveProperty('sourceHeight')
  })

  it('四千分辨率保留宽屏比例，未指定模型时省略模型字段', () => {
    expect(buildTextToImageRequest('宽屏森林', IMAGE_SIZE_PRESETS[3], 1, { resolution: '4k' })).toMatchObject({
      params: { resolution: '4k', size: { width: 4096, height: 2304 }, count: 1 },
    })
    expect(buildTextToImageRequest('森林', IMAGE_SIZE_PRESETS[0], 1, { resolution: '1k' })).not.toHaveProperty('modelProfileId')
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

  it('真实裂变保存指定模型、分辨率与原始尺寸，输出尺寸独立计算', () => {
    expect(buildVariationRequest(source, '保持构图', 2, { resolution: '2k', modelProfileId: 'chosen-model' })).toMatchObject({
      modelProfileId: 'chosen-model',
      params: { resolution: '2k', sourceWidth: 1600, sourceHeight: 900, size: { width: 2048, height: 1152 }, count: 2 },
    })
  })

  it('超过真实服务提示词限制时在提交前阻止请求', () => {
    expect(() => buildVariationRequest(source, '图'.repeat(10001), 1)).toThrow('补充要求最多')
  })
})
