import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability } from '@/types'
import { buildFusionRequest } from './fusion'

describe('buildFusionRequest', () => {
  it('默认一张，比例跟商品图，并带上场景图', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 1200, height: 800 })
    const referenceAsset = createImageAsset({ name: '场景', url: 'scene.png', width: 600, height: 900 })
    const request = buildFusionRequest({ sourceAsset, referenceAsset, resolution: '2k' })
    expect(request.capability).toBe(Capability.ImageEdit)
    expect(request.params).toEqual({
      sourceImageUrl: 'product.png',
      referenceImageUrl: 'scene.png',
      count: 1,
      resolution: '2k',
      size: { width: 2048, height: 1365 },
      sourceWidth: 1200,
      sourceHeight: 800,
    })
  })

  it('保留补充说明，数量不超过 4', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 800, height: 800 })
    const referenceAsset = createImageAsset({ name: '场景', url: 'scene.png', width: 400, height: 400 })
    const request = buildFusionRequest({
      sourceAsset,
      referenceAsset,
      prompt: '  放在桌面中央  ',
      count: 8,
    })
    expect(request.params).toMatchObject({ prompt: '放在桌面中央', count: 4, referenceImageUrl: 'scene.png' })
  })
})
