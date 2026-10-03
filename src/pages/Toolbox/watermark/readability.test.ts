import { describe, expect, it } from 'vitest'
import { migrateWatermarkSettings, DEFAULT_WATERMARK_SETTINGS } from './types'
import {
  averageLuminance, chooseTextColor, clampSampleRect, contrastingStrokeColor, DARK_TEXT, LIGHT_TEXT,
  LUMINANCE_SPLIT, pixelLuminance, resolveTextAppearance, textStrokeWidth,
} from './readability'

function pixels(rows: number[][]) {
  return new Uint8ClampedArray(rows.flat())
}

describe('文字水印明暗与描边', () => {
  it('透明像素按白底计算，不把未写入的黑色通道当成深色背景', () => {
    expect(pixelLuminance(255, 255, 255, 255)).toBe(1)
    expect(pixelLuminance(0, 0, 0, 255)).toBe(0)
    expect(pixelLuminance(0, 0, 0, 0)).toBe(1)
    expect(pixelLuminance(255, 255, 255, 0)).toBe(1)
    const mixed = pixels([[0, 0, 0, 255, 0, 0, 0, 0]])
    expect(averageLuminance(mixed, 2, 1)).toBeCloseTo(0.5, 5)
    expect(chooseTextColor(averageLuminance(mixed, 2, 1))).toBe(DARK_TEXT)
  })

  it('浅底用深色字，深底用浅色字', () => {
    expect(chooseTextColor(1)).toBe(DARK_TEXT)
    expect(chooseTextColor(LUMINANCE_SPLIT)).toBe(DARK_TEXT)
    expect(chooseTextColor(LUMINANCE_SPLIT - 0.001)).toBe(LIGHT_TEXT)
    expect(chooseTextColor(0)).toBe(LIGHT_TEXT)
  })

  it('大图抽样仍覆盖左右两半', () => {
    const width = 128
    const height = 128
    const data = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        const value = x < width / 2 ? 0 : 255
        data[index] = value
        data[index + 1] = value
        data[index + 2] = value
        data[index + 3] = 255
      }
    }
    expect(averageLuminance(data, width, height)).toBeCloseTo(0.5, 5)
    expect(chooseTextColor(averageLuminance(data, width, height))).toBe(DARK_TEXT)
  })

  it('浅色字配深色描边，描边宽度随字号缩放且至少 1px', () => {
    expect(contrastingStrokeColor(LIGHT_TEXT)).toBe('#000000')
    expect(contrastingStrokeColor(DARK_TEXT)).toBe('#ffffff')
    expect(contrastingStrokeColor('#00ff00')).toBe('#000000')
    expect(contrastingStrokeColor('white')).toBe('#000000')
    expect(textStrokeWidth(40)).toBeCloseTo(4.8)
    expect(textStrokeWidth(4)).toBe(1)
    expect(textStrokeWidth(0)).toBe(1)
    expect(textStrokeWidth(80) / 80).toBeCloseTo(textStrokeWidth(40) / 40)
  })

  it('自动模式跟随亮度，采样失败按浅底处理；自定义颜色不受亮度影响', () => {
    expect(resolveTextAppearance({
      colorMode: 'auto', color: '#ffffff', readability: true, fontSize: 40, luminance: 1,
    })).toEqual({ fill: DARK_TEXT, stroke: '#ffffff', strokeWidth: 4.8 })
    expect(resolveTextAppearance({
      colorMode: 'auto', color: '#ffffff', readability: true, fontSize: 40, luminance: 0,
    })).toEqual({ fill: LIGHT_TEXT, stroke: '#000000', strokeWidth: 4.8 })
    expect(resolveTextAppearance({
      colorMode: 'auto', color: '#ffffff', readability: true, fontSize: 40, luminance: null,
    }).fill).toBe(DARK_TEXT)
    expect(resolveTextAppearance({
      colorMode: 'custom', color: '#00ff00', readability: false, fontSize: 20, luminance: 0,
    })).toEqual({ fill: '#00ff00', stroke: null, strokeWidth: textStrokeWidth(20) })
  })

  it('采样矩形被限制在画布内', () => {
    expect(clampSampleRect(10.2, 10.2, 5.8, 5.8, 100, 80)).toEqual({ x: 10, y: 10, width: 6, height: 6 })
    expect(clampSampleRect(-4, -8, 300, 40, 120, 90)).toEqual({ x: 0, y: 0, width: 120, height: 32 })
    expect(clampSampleRect(0, 0, 10, 10, 0, 10)).toEqual({ x: 0, y: 0, width: 0, height: 0 })
  })

  it('旧设置缺少新字段时保留颜色，新默认值使用自动', () => {
    const legacy: Partial<typeof DEFAULT_WATERMARK_SETTINGS> = { ...DEFAULT_WATERMARK_SETTINGS, color: '#ff00aa', text: 'PIXEL TEST' }
    delete legacy.colorMode
    delete legacy.readability
    expect(migrateWatermarkSettings(legacy)).toMatchObject({
      colorMode: 'custom', color: '#ff00aa', text: 'PIXEL TEST', readability: true, layout: 'single',
    })
    expect(migrateWatermarkSettings({ colorMode: 'auto', readability: false, color: '#ffffff' })).toMatchObject({
      colorMode: 'auto', readability: false,
    })
    expect(DEFAULT_WATERMARK_SETTINGS).toMatchObject({ colorMode: 'auto', readability: true, color: '#ffffff' })
  })
})
