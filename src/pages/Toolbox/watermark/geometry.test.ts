import { describe, expect, it } from 'vitest'
import { outputNames, watermarkPosition, watermarkTilePositions } from './geometry'

describe('水印布局', () => {
  it('九宫格位置遵守图片边距', () => {
    expect(watermarkPosition(1200, 800, 200, 60, 24, 'bottom-right')).toEqual({ left: 976, top: 716 })
    expect(watermarkPosition(1200, 800, 200, 60, 24, 'middle-center')).toEqual({ left: 500, top: 370 })
    expect(watermarkPosition(800, 1200, 200, 60, 24, 'top-left')).toEqual({ left: 24, top: 24 })
  })

  it('超出图片的水印不会出现负坐标', () => {
    expect(watermarkPosition(100, 100, 120, 20, 10, 'bottom-right')).toEqual({ left: 0, top: 70 })
  })

  it('平铺覆盖旋转后的图片范围，并限制极端尺寸的绘制数量', () => {
    const positions = watermarkTilePositions(1200, 800, 180, 50, 80, -25)
    expect(positions.length).toBeGreaterThan(10)
    expect(watermarkTilePositions(1200, 800, 180, 50, 20, -25).length).toBeGreaterThan(positions.length)
    expect(positions.some(point => point.left < 0 && point.top < 0)).toBe(true)
    expect(positions.some(point => point.left > 0 && point.top > 0)).toBe(true)
    expect(watermarkTilePositions(1, 24000000, 0.1, 0.1, 0, 0).length).toBeLessThanOrEqual(900)
  })

  it('批量同名输出自动编号，并遵守真实导出格式', () => {
    expect(outputNames([
      { name: '商品.JPG', mimeType: 'image/jpeg' },
      { name: '商品.png', mimeType: 'image/jpeg' },
      { name: '封面.webp', mimeType: 'image/png' },
    ])).toEqual(['商品_watermarked.jpg', '商品_watermarked_2.jpg', '封面_watermarked.png'])
  })
})
