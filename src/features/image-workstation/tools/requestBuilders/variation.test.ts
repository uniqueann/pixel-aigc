import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability } from '@/types'
import { buildVariationRequest } from './variation'

describe('buildVariationRequest', () => {
  it('默认两张，提示词可省略，并按分辨率保持原图比例', () => {
    const sourceAsset = createImageAsset({ name: '商品图', url: 'source.png', width: 1200, height: 800 })
    const request = buildVariationRequest({ sourceAsset, resolution: '2k' })
    expect(request.capability).toBe(Capability.Variation)
    expect(request.params).toEqual({
      sourceImageUrl: 'source.png',
      count: 2,
      resolution: '2k',
      size: { width: 2048, height: 1365 },
      sourceWidth: 1200,
      sourceHeight: 800,
    })
    expect(request.outputSize).toEqual({ width: 2048, height: 1365 })
  })

  it('保留补充要求，数量不超过 4', () => {
    const sourceAsset = createImageAsset({ name: '商品图', url: 'source.png', width: 800, height: 800 })
    const request = buildVariationRequest({ sourceAsset, prompt: '  只换背景  ', count: 8 })
    expect(request.params).toMatchObject({ prompt: '只换背景', count: 4 })
  })
})
