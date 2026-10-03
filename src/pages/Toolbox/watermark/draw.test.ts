import { describe, expect, it, vi } from 'vitest'
import { drawWatermarkedImage } from './draw'
import { DARK_TEXT, LIGHT_TEXT } from './readability'
import { DEFAULT_WATERMARK_SETTINGS, type WatermarkSettings } from './types'

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
    strokeText: vi.fn(),
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

function pixelBuffer(width: number, height: number, paint: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b, a] = paint(x, y)
      const index = (y * width + x) * 4
      data[index] = r
      data[index + 1] = g
      data[index + 2] = b
      data[index + 3] = a
    }
  }
  return data
}

function contextFor(data: Uint8ClampedArray, width: number, height: number, textWidth = 60) {
  return {
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    measureText: vi.fn(() => ({ width: textWidth })),
    fillText: vi.fn(),
    strokeText: vi.fn(),
    getImageData: vi.fn((x: number, y: number, w: number, h: number) => {
      if (x < 0 || y < 0 || x + w > width || y + h > height) throw new Error('采样超出画布')
      const slice = new Uint8ClampedArray(w * h * 4)
      for (let row = 0; row < h; row += 1) {
        for (let column = 0; column < w; column += 1) {
          const source = ((y + row) * width + (x + column)) * 4
          slice.set(data.subarray(source, source + 4), (row * w + column) * 4)
        }
      }
      return { data: slice, width: w, height: h }
    }),
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    lineJoin: '',
    globalAlpha: 1,
    textBaseline: '',
    textAlign: '',
    shadowBlur: 1,
    shadowOffsetX: 1,
    shadowOffsetY: 1,
    shadowColor: '',
  }
}

function paint(settings: Partial<WatermarkSettings>, width: number, height: number, pixels: Uint8ClampedArray, textWidth = 60) {
  const context = contextFor(pixels, width, height, textWidth)
  drawWatermarkedImage(context as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, width, height, width, height, {
    ...DEFAULT_WATERMARK_SETTINGS, text: 'PIXEL TEST', ...settings,
  })
  return context
}

describe('文字水印可读性', () => {
  it('单个水印只看文字底下的区域，平铺看整张图；透明像素按浅色', () => {
    const width = 400
    const height = 300
    const pixels = pixelBuffer(width, height, (x, y) => x >= 250 && y >= 200 ? [0, 0, 0, 0] : [0, 0, 0, 255])
    const single = paint({ layout: 'single', anchor: 'bottom-right' }, width, height, pixels)
    const tiled = paint({ layout: 'tile' }, width, height, pixels)
    expect(single.fillStyle).toBe(DARK_TEXT)
    expect(single.strokeStyle).toBe('#ffffff')
    expect(single.strokeText).toHaveBeenCalledTimes(1)
    expect(single.getImageData.mock.calls[0][2] * single.getImageData.mock.calls[0][3]).toBeLessThan(width * height / 4)
    expect(tiled.fillStyle).toBe(LIGHT_TEXT)
    expect(tiled.strokeStyle).toBe('#000000')
    expect(tiled.getImageData).toHaveBeenCalledWith(0, 0, width, height)
  })

  it('白底、透明底自动用深色字，深底用浅色字，描边为对比色', () => {
    const white = pixelBuffer(80, 60, () => [255, 255, 255, 255])
    const clear = pixelBuffer(80, 60, () => [0, 0, 0, 0])
    const black = pixelBuffer(80, 60, () => [0, 0, 0, 255])
    expect(paint({}, 80, 60, white).fillStyle).toBe(DARK_TEXT)
    expect(paint({}, 80, 60, clear).fillStyle).toBe(DARK_TEXT)
    expect(paint({}, 80, 60, black).fillStyle).toBe(LIGHT_TEXT)
    expect(paint({}, 80, 60, black).strokeStyle).toBe('#000000')
  })

  it('自定义颜色不采样，关闭描边时不画轮廓', () => {
    const black = pixelBuffer(80, 60, () => [0, 0, 0, 255])
    const custom = paint({ colorMode: 'custom', color: '#ffffff' }, 80, 60, black)
    expect(custom.getImageData).not.toHaveBeenCalled()
    expect(custom.fillStyle).toBe('#ffffff')
    expect(custom.strokeStyle).toBe('#000000')
    expect(custom.shadowBlur).toBe(0)
    const plain = paint({ readability: false }, 80, 60, black)
    expect(plain.strokeText).not.toHaveBeenCalled()
    expect(plain.fillText).toHaveBeenCalled()
    expect(plain.shadowBlur).toBe(0)
  })

  it('采样失败按浅底处理，描边宽度随最终字号缩放', () => {
    const context = contextFor(pixelBuffer(40, 40, () => [0, 0, 0, 255]), 40, 40)
    context.getImageData.mockImplementation(() => { throw new Error('无法读取像素') })
    drawWatermarkedImage(context as unknown as CanvasRenderingContext2D, {} as CanvasImageSource, 40, 40, 40, 40, {
      ...DEFAULT_WATERMARK_SETTINGS, text: 'PIXEL TEST',
    })
    expect(context.fillStyle).toBe(DARK_TEXT)

    const wide = paint({ colorMode: 'custom', color: '#ffffff' }, 2000, 2000, pixelBuffer(1, 1, () => [0, 0, 0, 255]), 4000)
    expect(wide.lineWidth).toBeCloseTo(4.512)
    const preview = paint({}, 400, 300, pixelBuffer(400, 300, () => [255, 255, 255, 255]))
    const full = paint({}, 800, 600, pixelBuffer(800, 600, () => [255, 255, 255, 255]))
    const previewSize = Number(/([0-9.]+)px/.exec(preview.font)?.[1])
    const fullSize = Number(/([0-9.]+)px/.exec(full.font)?.[1])
    expect(preview.fillStyle).toBe(full.fillStyle)
    expect(preview.strokeStyle).toBe(full.strokeStyle)
    expect(preview.lineWidth / previewSize).toBeCloseTo(full.lineWidth / fullSize)
  })

  it('主线程与 Worker 对同一像素给出相同文字样式，且不依赖导出格式', () => {
    const pixels = pixelBuffer(120, 80, (x, y) => y < 40 ? [255, 255, 255, 255] : [x, 0, 0, 0])
    const main = paint({ anchor: 'top-left' }, 120, 80, pixels)
    const worker = paint({ anchor: 'top-left' }, 120, 80, pixels)
    const view = (context: ReturnType<typeof paint>) => ({
      fillStyle: context.fillStyle,
      strokeStyle: context.strokeStyle,
      lineWidth: context.lineWidth,
      lineJoin: context.lineJoin,
      shadowBlur: context.shadowBlur,
      strokes: context.strokeText.mock.calls,
      fills: context.fillText.mock.calls,
      samples: context.getImageData.mock.calls,
    })
    expect(view(worker)).toEqual(view(main))
    expect(main.fillStyle).toBe(DARK_TEXT)
    expect(main.strokeText.mock.calls).toEqual(main.fillText.mock.calls)
  })
})
