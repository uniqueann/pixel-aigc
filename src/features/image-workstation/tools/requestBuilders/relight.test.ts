import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability } from '@/types'
import { RELIGHT_DEFAULT } from '@shared/relight'
import { buildRelightRequest } from './relight'

describe('buildRelightRequest', () => {
  it('默认两张，并带上默认光效', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 1200, height: 800 })
    const request = buildRelightRequest({ sourceAsset, resolution: '2k' })
    expect(request.capability).toBe(Capability.ImageEdit)
    expect(request.params).toEqual({
      sourceImageUrl: 'product.png',
      count: 2,
      resolution: '2k',
      size: { width: 2048, height: 1365 },
      sourceWidth: 1200,
      sourceHeight: 800,
      relight: RELIGHT_DEFAULT,
    })
  })

  it('保留补充说明和所选光效，数量不超过 4', () => {
    const sourceAsset = createImageAsset({ name: '商品', url: 'product.png', width: 800, height: 800 })
    const request = buildRelightRequest({
      sourceAsset,
      prompt: '  略提亮背景  ',
      count: 8,
      relight: { direction: 'left', quality: 'hard', temperature: 'cool' },
    })
    expect(request.params).toMatchObject({
      prompt: '略提亮背景',
      count: 4,
      relight: { direction: 'left', quality: 'hard', temperature: 'cool' },
    })
  })
})
