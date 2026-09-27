import { describe, expect, it } from 'vitest'
import {
  ERASE_OVERLAY_HEIGHT,
  ERASE_OVERLAY_WIDTH,
  MASK_WHITE_THRESHOLD,
  containRect,
  dilateMask,
  fitDashScopeImageSize,
  mapOverlayMaskToImage,
  maskHasEraseRegion,
  normalizeErasePrompt,
  scaleMaskNearest,
  thresholdMask,
  thresholdPaintedOverlay,
} from './erase'

function rgbaFromLuma(values: number[]) {
  const rgba = new Uint8Array(values.length * 4)
  values.forEach((value, index) => {
    rgba[index * 4] = value
    rgba[index * 4 + 1] = value
    rgba[index * 4 + 2] = value
    rgba[index * 4 + 3] = 255
  })
  return rgba
}

describe('消除蒙版几何', () => {
  it('把灰边收成纯黑白，白色才是消除区', () => {
    const rgba = rgbaFromLuma([0, 40, 127, 128, 200, 255])
    const mask = thresholdMask(rgba, 6, 1, 4)
    expect(Array.from(mask)).toEqual([0, 0, 0, 255, 255, 255])
  })

  it('涂抹层只看 alpha，半透明红笔也算选区', () => {
    const rgba = new Uint8Array([220, 38, 38, 128, 0, 0, 0, 0])
    expect(Array.from(thresholdPaintedOverlay(rgba, 2, 1))).toEqual([255, 0])
  })

  it('最近邻缩放后仍是纯黑白，几何按中心采样', () => {
    const source = new Uint8Array([255, 0, 0, 0])
    const scaled = scaleMaskNearest(source, 2, 2, 4, 4)
    expect(scaled.length).toBe(16)
    expect(scaled.every(value => value === 0 || value === 255)).toBe(true)
    expect(scaled[0]).toBe(255)
    expect(scaled[3]).toBe(0)
    expect(scaled[15]).toBe(0)
  })

  it('膨胀会把白色向外扩几像素', () => {
    const mask = new Uint8Array([
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 255, 0, 0,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ])
    const dilated = dilateMask(mask, 5, 5, 1)
    expect(dilated[2 * 5 + 2]).toBe(255)
    expect(dilated[2 * 5 + 1]).toBe(255)
    expect(dilated[1 * 5 + 2]).toBe(255)
    expect(dilated[0]).toBe(0)
  })

  it('640×420 contain 映射只取图内笔划，忽略左右黑边', () => {
    const overlay = new Uint8Array(ERASE_OVERLAY_WIDTH * ERASE_OVERLAY_HEIGHT)
    const image = { width: 2000, height: 1000 }
    const rect = containRect(image.width, image.height, ERASE_OVERLAY_WIDTH, ERASE_OVERLAY_HEIGHT)
    expect(rect.width).toBe(640)
    expect(rect.height).toBe(320)
    expect(rect.y).toBe(50)
    overlay[10 * ERASE_OVERLAY_WIDTH + 20] = 255
    overlay[(rect.y + 8) * ERASE_OVERLAY_WIDTH + rect.x + 16] = 255
    const mapped = mapOverlayMaskToImage(overlay, ERASE_OVERLAY_WIDTH, ERASE_OVERLAY_HEIGHT, image.width, image.height)
    expect(mapped.length).toBe(image.width * image.height)
    expect(maskHasEraseRegion(mapped)).toBe(true)
    const letterboxOnly = new Uint8Array(ERASE_OVERLAY_WIDTH * ERASE_OVERLAY_HEIGHT)
    letterboxOnly[10 * ERASE_OVERLAY_WIDTH + 20] = 255
    expect(maskHasEraseRegion(mapOverlayMaskToImage(
      letterboxOnly, ERASE_OVERLAY_WIDTH, ERASE_OVERLAY_HEIGHT, image.width, image.height,
    ))).toBe(false)
  })

  it('送模尺寸与扩图同一套 512–4096 拟合，蒙版按同一比例缩放', () => {
    const fitted = fitDashScopeImageSize(2048, 1365)
    expect(fitted.width).toBe(2048)
    expect(fitted.height).toBe(1365)
    const small = fitDashScopeImageSize(400, 300)
    expect(Math.min(small.width, small.height)).toBe(512)
    expect(small.width / small.height).toBeCloseTo(400 / 300, 2)
    const huge = fitDashScopeImageSize(8000, 2000)
    expect(Math.max(huge.width, huge.height)).toBe(4096)
    const mask = new Uint8Array(400 * 300)
    mask[10 * 400 + 20] = 255
    const scaled = scaleMaskNearest(mask, 400, 300, small.width, small.height)
    expect(scaled.length).toBe(small.width * small.height)
    expect(maskHasEraseRegion(scaled)).toBe(true)
    expect(scaled.every(value => value === 0 || value === 255)).toBe(true)
  })

  it('背景描述默认空串，超长截到 800', () => {
    expect(normalizeErasePrompt(undefined)).toBe('')
    expect(normalizeErasePrompt('  白墙木地板  ')).toBe('白墙木地板')
    expect(normalizeErasePrompt('x'.repeat(900)).length).toBe(800)
  })

  it('阈值边界：127 为黑，128 为白', () => {
    expect(MASK_WHITE_THRESHOLD).toBe(128)
    const mask = thresholdMask(new Uint8Array([127, 128]), 2, 1, 1)
    expect(Array.from(mask)).toEqual([0, 255])
  })
})
