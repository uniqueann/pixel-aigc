import { describe, expect, it } from 'vitest'
import { validH3VideoShape } from './validation.js'

describe('H3 原图比例与结果档位校验', () => {
  it.each([
    ['768p', 1366, 768, 1600, 900], ['768p', 768, 1366, 900, 1600],
    ['2k', 2048, 2048, 1200, 1200], ['2k', 2048, 2560, 800, 1000],
  ] as const)('%s 接受标准或非标准原图比例 %i×%i', (resolution, width, height, sourceWidth, sourceHeight) => {
    expect(validH3VideoShape({ width, height, durationSeconds: 5.04 }, { mode: 'image_to_video', ratio: 'adaptive', resolution, durationSeconds: 5 }, { width: sourceWidth, height: sourceHeight })).toBe(true)
  })
  it('不接受错档、改比例、错误时长或缺少实测原图尺寸', () => {
    const params = { mode: 'image_to_video', resolution: '2k', durationSeconds: 5 }
    for (const output of [{ width: 768, height: 768, durationSeconds: 5 }, { width: 2560, height: 1440, durationSeconds: 5 }, { width: 2048, height: 2048, durationSeconds: 10 }]) {
      expect(validH3VideoShape(output, params, { width: 800, height: 800 })).toBe(false)
    }
    expect(validH3VideoShape({ width: 2048, height: 2048, durationSeconds: 5 }, params, undefined)).toBe(false)
  })
})
