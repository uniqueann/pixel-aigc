import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { prepareMattingImage, restoreMattingImage } from './bg-remove-image'

async function fixture(width: number, height: number, alpha = 255) {
  const rgba = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4
    rgba[offset] = x * 5 % 256
    rgba[offset + 1] = y * 5 % 256
    rgba[offset + 2] = 123
    rgba[offset + 3] = alpha
  }
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

async function matte(width: number, height: number, alpha: (x: number, y: number) => number) {
  const rgba = Buffer.alloc(width * height * 4, 255)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) rgba[(y * width + x) * 4 + 3] = alpha(x, y)
  return sharp(rgba, { raw: { width, height, channels: 4 } }).png().toBuffer()
}

describe('抠图工作副本与原尺寸透明度恢复', () => {
  it('合规且无 EXIF 的 JPEG 复用原字节，不重复压缩', async () => {
    const source = await sharp(await fixture(64, 40)).removeAlpha().jpeg().toBuffer()
    const prepared = await prepareMattingImage(source)
    expect(prepared.bytes).toBe(source)
    expect(prepared).toMatchObject({ reusableSource: true, width: 64, height: 40, workWidth: 64, workHeight: 40 })
  })

  it('恢复经过缩小的 Alpha，商品 RGB 使用原图，保留半透明像素', async () => {
    const source = await fixture(80, 40, 128)
    const prepared = await prepareMattingImage(source, { maxWidth: 40, maxHeight: 32 })
    expect(prepared).toMatchObject({ width: 80, height: 40, workWidth: 40, workHeight: 32, contentWidth: 40, contentHeight: 20 })
    const result = await restoreMattingImage(await matte(40, 32, x => x < 20 ? 0 : 128), prepared)
    const decoded = await sharp(result).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 80, height: 40, channels: 4 })
    const left = (20 * 80 + 10) * 4
    const right = (20 * 80 + 70) * 4
    expect([...decoded.data.subarray(left, left + 4)]).toEqual([0, 0, 0, 0])
    expect([...decoded.data.subarray(right, right + 4)]).toEqual([94, 100, 123, 64])
    const edge = Array.from({ length: 8 }, (_, i) => decoded.data[(20 * 80 + 36 + i) * 4 + 3])
    expect(edge.some(alpha => alpha > 0 && alpha < 64)).toBe(true)
  })

  it('超高竖图保持朝向并等比缩小，补白和 Alpha 恢复不改变商品位置', async () => {
    const prepared = await prepareMattingImage(await fixture(12, 40), { maxWidth: 64, maxHeight: 32 })
    expect(prepared).toMatchObject({ width: 12, height: 40, contentWidth: 10, contentHeight: 32, workWidth: 32, workHeight: 32 })
    const work = await sharp(prepared.bytes).raw().toBuffer()
    // 用原图颜色定位上下，验证识别副本内的商品保持直立。
    expect(work[(4 * 32 + 5) * 3 + 1]).toBeLessThan(50)
    expect(work[(27 * 32 + 5) * 3 + 1]).toBeGreaterThan(150)
    const result = await restoreMattingImage(await matte(32, 32, (x, y) => x >= 10 ? 255 : y >= 24 ? 128 : 0), prepared)
    const decoded = await sharp(result).raw().toBuffer()
    expect(decoded[(35 * 12 + 5) * 4 + 3]).toBe(128)
    expect(decoded[(5 * 12 + 5) * 4 + 3]).toBe(0)
    expect(decoded[(5 * 12 + 11) * 4 + 3]).toBe(0)
    expect([...decoded.subarray((35 * 12 + 5) * 4, (35 * 12 + 5) * 4 + 3)]).toEqual([25, 175, 123])
  })

  it('3200×5035 大图使用 2746×4320 直立副本，恢复原尺寸和原图 RGB', async () => {
    const image = await sharp({ create: { width: 3200, height: 5035, channels: 3, background: '#aa2211' } }).jpeg().toBuffer()
    const prepared = await prepareMattingImage(image)
    expect(prepared).toMatchObject({ width: 3200, height: 5035, workWidth: 2746, workHeight: 4320,
      contentWidth: 2746, contentHeight: 4320, reusableSource: false })
    expect(await sharp(prepared.bytes).metadata()).toMatchObject({ width: 2746, height: 4320 })
    const result = await restoreMattingImage(await matte(2746, 4320, (x, y) =>
      x > 686 && x < 2060 && y > 1080 && y < 3240 ? 255 : 0), prepared)
    const decoded = await sharp(result).raw().toBuffer({ resolveWithObject: true })
    expect(decoded.info).toMatchObject({ width: 3200, height: 5035, channels: 4 })
    expect(decoded.data[(2500 * 3200 + 1600) * 4 + 3]).toBe(255)
    expect(decoded.data[(500 * 3200 + 1600) * 4 + 3]).toBe(0)
    expect(decoded.data[(2500 * 3200 + 300) * 4 + 3]).toBe(0)
    const original = await sharp(image).ensureAlpha().raw().toBuffer()
    const offset = (2500 * 3200 + 1600) * 4
    expect(decoded.data.subarray(offset, offset + 3)).toEqual(original.subarray(offset, offset + 3))
  })

  it('EXIF 方向以浏览器看到的尺寸为准，WebP 自动转换', async () => {
    const source = await sharp(await fixture(40, 12)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const prepared = await prepareMattingImage(source)
    expect(prepared).toMatchObject({ width: 12, height: 40, reusableSource: false })
    const result = await restoreMattingImage(await matte(prepared.workWidth, prepared.workHeight, () => 255), prepared)
    const decoded = await sharp(result).raw().toBuffer()
    const original = await sharp(source).autoOrient().toColourspace('srgb').ensureAlpha().raw().toBuffer()
    expect(decoded).toEqual(original)
    const webp = await sharp(source).webp().toBuffer()
    expect(await prepareMattingImage(webp)).toMatchObject({ mimeType: 'image/jpeg', reusableSource: false })
  })

  it('体积超限时压缩副本，结果恢复原尺寸', async () => {
    const prepared = await prepareMattingImage(await fixture(200, 100), { maxBytes: 900 })
    expect(prepared.bytes.length).toBeLessThanOrEqual(900)
    expect(prepared).toMatchObject({ width: 200, height: 100 })
    const result = await restoreMattingImage(await matte(prepared.workWidth, prepared.workHeight, () => 255), prepared)
    expect(await sharp(result).metadata()).toMatchObject({ width: 200, height: 100 })
  })

  it('无透明通道、尺寸异常、损坏响应和截止时间不能生成假成功结果', async () => {
    const prepared = await prepareMattingImage(await fixture(64, 40))
    const opaque = await sharp(await fixture(prepared.workWidth, prepared.workHeight)).removeAlpha().png().toBuffer()
    await expect(restoreMattingImage(opaque, prepared)).rejects.toMatchObject({ code: 'BG_REMOVE_INVALID_RESULT' })
    await expect(restoreMattingImage(await fixture(32, 32), prepared)).rejects.toMatchObject({ code: 'BG_REMOVE_INVALID_RESULT' })
    await expect(restoreMattingImage(Buffer.from('假的 PNG'), prepared)).rejects.toMatchObject({ code: 'BG_REMOVE_INVALID_RESULT' })
    await expect(prepareMattingImage(await fixture(32, 32), { deadlineAt: Date.now() - 1 })).rejects.toMatchObject({ status: 504 })
  })
})
