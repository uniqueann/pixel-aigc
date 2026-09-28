import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { observedPixels } from '../image-providers/dragoncode/fixtures.js'
import { cropRect, cropToSourceAspect } from './aspect-crop.js'

describe('cropToSourceAspect', () => {
  it('按原图比例居中裁切更宽的输出', async () => {
    expect(cropRect(200, 100, 1)).toEqual({ left: 50, top: 0, width: 100, height: 100, cropped: true })
    const source = await sharp({ create: { width: 200, height: 100, channels: 3, background: '#f00' } }).png().toBuffer()
    const cropped = await cropToSourceAspect(source, 100, 100)
    expect(cropped).toMatchObject({ width: 100, height: 100, mimeType: 'image/png', cropped: true })
    const meta = await sharp(cropped.bytes).metadata()
    expect(meta).toMatchObject({ width: 100, height: 100 })
  })

  it('比例已经接近时不裁切', async () => {
    const source = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#0f0' } }).png().toBuffer()
    const result = await cropToSourceAspect(source, 1200, 800)
    expect(result.cropped).toBe(false)
    expect(result).toMatchObject({ width: 120, height: 80 })
  })

  it('输出更高时裁切上下', () => {
    expect(cropRect(100, 200, 1)).toEqual({ left: 0, top: 50, width: 100, height: 100, cropped: true })
  })

  it('DragonCode 实测 off-by-one 像素与官方比例视为已对齐', () => {
    expect(cropRect(observedPixels['1k:1:1'].width, observedPixels['1k:1:1'].height, 1).cropped).toBe(false)
    expect(cropRect(observedPixels['1k:3:2'].width, observedPixels['1k:3:2'].height, 3 / 2).cropped).toBe(false)
    expect(cropRect(observedPixels['1k:3:4'].width, observedPixels['1k:3:4'].height, 3 / 4).cropped).toBe(false)
    expect(cropRect(observedPixels['2k:16:9'].width, observedPixels['2k:16:9'].height, 16 / 9).cropped).toBe(false)
    expect(cropRect(observedPixels['4k:16:9'].width, observedPixels['4k:16:9'].height, 16 / 9).cropped).toBe(false)
    expect(cropRect(observedPixels['4k:16:9'].width, observedPixels['4k:16:9'].height, 1920 / 1080).cropped).toBe(false)
  })

  it('4K 16:9 的 3840x2161 仍可按原图比例居中裁切', () => {
    const square = cropRect(3840, 2161, 1)
    expect(square).toMatchObject({ cropped: true, height: 2161, width: 2161 })
    const threeTwo = cropRect(3840, 2161, 3 / 2)
    expect(threeTwo.cropped).toBe(true)
    expect(threeTwo.width).toBe(Math.round(2161 * 1.5))
  })
})
