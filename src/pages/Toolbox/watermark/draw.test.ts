import { describe, expect, it, vi } from 'vitest'
import { drawWatermarkedImage } from './draw'
import { DEFAULT_WATERMARK_SETTINGS } from './types'

function drawingContext() {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    measureText: vi.fn(() => ({ width: 160 })),
    fillText: vi.fn(),
  }
}

describe('水印绘制', () => {
  it('文字水印从单点切换到平铺后重复绘制并旋转', () => {
    const source = {} as CanvasImageSource
    const single = drawingContext()
    drawWatermarkedImage(single as unknown as CanvasRenderingContext2D, source, 1200, 800, 1200, 800, {
      ...DEFAULT_WATERMARK_SETTINGS, text: '品牌',
    })
    expect(single.fillText).toHaveBeenCalledTimes(1)

    const tiled = drawingContext()
    drawWatermarkedImage(tiled as unknown as CanvasRenderingContext2D, source, 1200, 800, 1200, 800, {
      ...DEFAULT_WATERMARK_SETTINGS, layout: 'tile', text: '品牌',
    })
    expect(tiled.fillText.mock.calls.length).toBeGreaterThan(10)
    expect(tiled.rotate).toHaveBeenCalledWith(-25 * Math.PI / 180)
  })

  it('Logo 水印也能平铺', () => {
    const source = {} as CanvasImageSource
    const logo = { width: 200, height: 100 } as CanvasImageSource & { width: number; height: number }
    const context = drawingContext()
    drawWatermarkedImage(context as unknown as CanvasRenderingContext2D, source, 1200, 800, 1200, 800, {
      ...DEFAULT_WATERMARK_SETTINGS, kind: 'logo', layout: 'tile', logo: new Blob(),
    }, logo)
    expect(context.drawImage.mock.calls.length).toBeGreaterThan(2)
  })
})
