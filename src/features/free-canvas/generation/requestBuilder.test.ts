import { describe, expect, it } from 'vitest'
import { Capability } from '@/types'
import { IMAGE_SIZE_PRESETS } from './config'
import { buildTextToImageRequest } from './requestBuilder'

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
