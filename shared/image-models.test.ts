import { describe, expect, it } from 'vitest'
import {
  DRAGONCODE_RATIOS,
  DRAGONCODE_SIZES,
  RESOLUTION_DOWNGRADED_4K,
  mapDragonCodeSize,
  nearestRatio,
} from './image-models'

const exact: Array<[number, number, string]> = [
  [1000, 1000, '1:1'],
  [3000, 2000, '3:2'],
  [2000, 3000, '2:3'],
  [4000, 3000, '4:3'],
  [3000, 4000, '3:4'],
  [5000, 4000, '5:4'],
  [4000, 5000, '4:5'],
  [1600, 900, '16:9'],
  [900, 1600, '9:16'],
  [2000, 1000, '2:1'],
  [1000, 2000, '1:2'],
  [2100, 900, '21:9'],
  [900, 2100, '9:21'],
]

describe('nearestRatio / mapDragonCodeSize', () => {
  it('精确命中全部官方比例', () => {
    for (const [width, height, ratio] of exact) {
      expect(nearestRatio(width, height)).toBe(ratio)
      expect(mapDragonCodeSize(width, height, '2k')).toEqual({ size: ratio, resolution: '2k', warnings: [] })
      expect(mapDragonCodeSize(width, height, '1k')).toEqual({ size: ratio, resolution: '1k', warnings: [] })
    }
  })

  it('把常见商品图映射到最近比例', () => {
    expect(nearestRatio(1200, 800)).toBe('3:2')
    expect(nearestRatio(1600, 1200)).toBe('4:3')
    expect(nearestRatio(1080, 1920)).toBe('9:16')
    expect(nearestRatio(5000, 1000)).toBe('21:9')
  })

  it('4k 仅在支持的宽比例上保留，否则降为 2k', () => {
    expect(mapDragonCodeSize(1080, 1920, '4k')).toEqual({ size: '9:16', resolution: '4k', warnings: [] })
    expect(mapDragonCodeSize(1920, 1080, '4k')).toEqual({ size: '16:9', resolution: '4k', warnings: [] })
    expect(mapDragonCodeSize(1000, 1000, '4k')).toEqual({
      size: '1:1', resolution: '2k', warnings: [RESOLUTION_DOWNGRADED_4K],
    })
    expect(mapDragonCodeSize(1200, 800, '4k')).toEqual({
      size: '3:2', resolution: '2k', warnings: [RESOLUTION_DOWNGRADED_4K],
    })
  })

  it('可限制候选比例集合', () => {
    expect(nearestRatio(1000, 1000, ['16:9', '9:16'])).toBe('16:9')
    expect(DRAGONCODE_RATIOS).toHaveLength(13)
    expect(DRAGONCODE_SIZES).toEqual([
      'auto', '1:1', '3:2', '2:3', '4:3', '3:4', '5:4', '4:5',
      '16:9', '9:16', '2:1', '1:2', '21:9', '9:21',
    ])
  })
})
