import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { buildImageEditRequest, scaleToLongEdge } from './imageEdit'

describe('buildImageEditRequest', () => {
  it('清理提示词、限制数量并按分辨率保持原图比例', () => {
    const sourceAsset = createImageAsset({ name: '商品图', url: 'source.png', width: 1200, height: 800 })
    const request = buildImageEditRequest({
      sourceAsset,
      prompt: '  换成白色背景  ',
      count: 8,
      resolution: '2k',
    })

    expect(request.params).toMatchObject({
      sourceImageUrl: 'source.png',
      prompt: '换成白色背景',
      count: 4,
      resolution: '2k',
      size: { width: 2048, height: 1365 },
    })
    expect(request.outputSize).toEqual({ width: 2048, height: 1365 })
  })

  it('正确处理纵向图片', () => {
    expect(scaleToLongEdge(600, 1200, 4096)).toEqual({ width: 2048, height: 4096 })
  })
})
