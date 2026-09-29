import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability } from '@/types'
import { buildRetouchRequest } from './retouch'

describe('buildRetouchRequest', () => {
  it('默认一张，方向按面板顺序提交为智能编辑任务', () => {
    const sourceAsset = createImageAsset({ name: '商品图', url: 'source.png', width: 1200, height: 800 })
    const request = buildRetouchRequest({
      sourceAsset,
      retouchDirections: ['texture', 'blemish'],
      resolution: '2k',
    })
    expect(request.capability).toBe(Capability.ImageEdit)
    expect(request.params).toEqual({
      sourceImageUrl: 'source.png',
      count: 1,
      resolution: '2k',
      size: { width: 2048, height: 1365 },
      sourceWidth: 1200,
      sourceHeight: 800,
      retouchDirections: ['blemish', 'texture'],
    })
  })

  it('保留补充说明，数量不超过 4', () => {
    const sourceAsset = createImageAsset({ name: '商品图', url: 'source.png', width: 800, height: 800 })
    const request = buildRetouchRequest({
      sourceAsset,
      retouchDirections: ['brighten'],
      prompt: '  不要改吊牌  ',
      count: 9,
    })
    expect(request.params).toMatchObject({
      prompt: '不要改吊牌',
      count: 4,
      retouchDirections: ['brighten'],
    })
  })
})
