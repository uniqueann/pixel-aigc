import { describe, expect, it } from 'vitest'
import { containRect, coverCrop, fitScale, outputMime, outputNames, outputSize, sameAspect } from './geometry'

describe('转比例几何', () => {
  it('留白居中且不越出目标画布', () => {
    const fitted = containRect(800, 400, 1000, 1000)
    expect(fitted.width).toBe(1000)
    expect(fitted.height).toBe(500)
    expect(fitted.x).toBe(0)
    expect(fitted.y).toBe(250)
    expect(fitted.x + fitted.width).toBeLessThanOrEqual(1000)
    expect(fitted.y + fitted.height).toBeLessThanOrEqual(1000)
  })

  it('裁剪焦点决定溢出对齐', () => {
    const top = coverCrop(500, 1000, 500, 500, 0.5, 0)
    const bottom = coverCrop(500, 1000, 500, 500, 0.5, 1)
    expect(top.sy).toBe(0)
    expect(bottom.sy).toBeGreaterThan(top.sy)
    expect(top.sw).toBeCloseTo(500)
    expect(top.sh).toBeCloseTo(500)
  })

  it('比例一致时两种策略的缩放倍数相同', () => {
    expect(sameAspect(1600, 1600, 800, 800)).toBe(true)
    expect(fitScale('letterbox', 1600, 1600, 800, 800)).toBe(fitScale('crop', 1600, 1600, 800, 800))
  })

  it('预览缩小，导出保持 preset 像素', () => {
    expect(outputSize(1600, 1600)).toEqual({ width: 1600, height: 1600, scale: 1 })
    expect(outputSize(1080, 1440, 800)).toEqual({ width: 600, height: 800, scale: 800 / 1440 })
  })

  it('只有透明留白输出 PNG', () => {
    expect(outputMime('letterbox', 'transparent')).toBe('image/png')
    expect(outputMime('letterbox', '#ffffff')).toBe('image/jpeg')
    expect(outputMime('crop', 'transparent')).toBe('image/jpeg')
  })

  it('文件名按平台去重', () => {
    expect(outputNames([
      { name: '商品.jpg', mimeType: 'image/jpeg', presetId: 'amazon-main' },
      { name: '商品.png', mimeType: 'image/jpeg', presetId: 'amazon-main' },
    ])).toEqual(['商品_amazon-main.jpg', '商品_amazon-main_2.jpg'])
  })
})
