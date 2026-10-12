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

  it('损坏或无法解码的图片抛出 BAD_RESULT 错误', async () => {
    const badPng = Uint8Array.from([
      137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1,
      8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207,
      192, 240, 31, 0, 5, 0, 1, 255, 23, 82, 97, 93, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
    ])
    await expect(cropToSourceAspect(badPng, 100, 100)).rejects.toMatchObject({
      status: 502,
      code: 'BAD_RESULT',
      message: '结果图片损坏或无法解码',
    })
    await expect(cropToSourceAspect(Buffer.from('not-an-image'), 100, 100)).rejects.toMatchObject({
      status: 502,
      code: 'BAD_RESULT',
    })
  })

  it('修正后的模拟 1x1 PNG 能正常通过解码', async () => {
    const { MOCK_PNG_1X1 } = await import('../image-providers/mock.js')
    const result = await cropToSourceAspect(MOCK_PNG_1X1, 1, 1)
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
    expect(result.mimeType).toBe('image/png')
  })
})

