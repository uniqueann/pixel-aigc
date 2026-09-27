import { describe, expect, it } from 'vitest'
import { createImageAsset } from '@/editor/services/assetService'
import { Capability } from '@/types'
import { buildInpaintRequest } from './inpaint'

const source = createImageAsset({
  name: '商品.jpg',
  url: 'source.jpg',
  width: 1600,
  height: 1200,
})

describe('消除/重绘请求', () => {
  it('消除带上可选背景描述，尺寸与原图一致', () => {
    const request = buildInpaintRequest({
      sourceAsset: source,
      maskUrl: 'data:image/png;base64,mask',
      prompt: '浅色木桌',
    }, 'remove')
    expect(request.capability).toBe(Capability.Inpaint)
    expect(request.params).toMatchObject({
      mode: 'remove',
      maskUrl: 'data:image/png;base64,mask',
      prompt: '浅色木桌',
    })
    expect(request.outputSize).toEqual({ width: 1600, height: 1200 })
  })

  it('消除没有背景描述时不传 prompt', () => {
    const request = buildInpaintRequest({
      sourceAsset: source,
      maskUrl: 'data:image/png;base64,mask',
    }, 'remove')
    expect(request.params).toMatchObject({ mode: 'remove', prompt: undefined })
  })
})
