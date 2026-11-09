import { describe, expect, it } from 'vitest'
import { outpaintTargetMode, outpaintTargetParameters, type OutpaintTargetMode } from './outpaintTarget'

describe('扩图输出目标', () => {
  it.each<[OutpaintTargetMode, 'free' | 'preset', 'original' | 'platform']>([
    ['free', 'free', 'original'],
    ['platform-ratio', 'preset', 'original'],
    ['platform-size', 'preset', 'platform'],
  ])('%s 映射为 %s + %s', (target, mode, outputMode) => {
    expect(outpaintTargetParameters(target)).toEqual({
      outpaintMode: mode,
      outpaintOutputMode: outputMode,
    })
    expect(outpaintTargetMode(mode, outputMode)).toBe(target)
  })

  it('两个持久化字段的任意组合都能收敛到唯一选项', () => {
    expect(outpaintTargetMode('free', 'original')).toBe('free')
    expect(outpaintTargetMode('free', 'platform')).toBe('free')
    expect(outpaintTargetMode('preset', 'original')).toBe('platform-ratio')
    expect(outpaintTargetMode('preset', 'platform')).toBe('platform-size')
  })
})
