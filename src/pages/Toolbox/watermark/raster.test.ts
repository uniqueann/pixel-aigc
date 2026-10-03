import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { canvasSizeForSource, WATERMARK_OUTPUT_QUALITY } from './raster'

describe('水印画布尺寸', () => {
  it('预览最长边缩小，导出保持原尺寸', () => {
    expect(canvasSizeForSource(4000, 3000)).toEqual({ width: 4000, height: 3000 })
    expect(canvasSizeForSource(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 })
    expect(canvasSizeForSource(800, 600, 2000)).toEqual({ width: 800, height: 600 })
    expect(canvasSizeForSource(1, 1, 100)).toEqual({ width: 1, height: 1 })
    expect(WATERMARK_OUTPUT_QUALITY).toBe(0.92)
  })
})

describe('Worker 与主线程回退', () => {
  it('两条路径只共享绘制和尺寸，不各自决定文字颜色', () => {
    const worker = readFileSync(new URL('./watermark.worker.ts', import.meta.url), 'utf8')
    const main = readFileSync(new URL('./renderer.ts', import.meta.url), 'utf8')
    for (const source of [worker, main]) {
      expect(source).toContain('drawWatermarkedImage')
      expect(source).toContain('canvasSizeForSource')
      expect(source).toContain('WATERMARK_OUTPUT_QUALITY')
      expect(source).not.toContain('getImageData')
      expect(source).not.toContain('fillText')
      expect(source).not.toContain('colorMode')
    }
  })
})
