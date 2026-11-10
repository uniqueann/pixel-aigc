import { describe, expect, it } from 'vitest'
import { compareAspectCompatible, comparePositionFromClientX } from './compareSlider'

describe('分割线位置换算', () => {
  it('按对比框宽度换算百分比并夹到 0-100', () => {
    expect(comparePositionFromClientX(100, { left: 0, width: 400 })).toBe(25)
    expect(comparePositionFromClientX(-20, { left: 0, width: 400 })).toBe(0)
    expect(comparePositionFromClientX(500, { left: 0, width: 400 })).toBe(100)
    expect(comparePositionFromClientX(120, { left: 20, width: 200 })).toBe(50)
  })

  it('宽度无效时返回 undefined，避免除零', () => {
    expect(comparePositionFromClientX(100, { left: 0, width: 0 })).toBeUndefined()
    expect(comparePositionFromClientX(100, { left: 0, width: Number.NaN })).toBeUndefined()
  })
})

describe('宽高比兼容判断', () => {
  it('同比例不同像素尺寸可以分割对比', () => {
    expect(compareAspectCompatible({ width: 1200, height: 800 }, { width: 2048, height: 1365 })).toBe(true)
  })

  it('比例差异超过 2% 时降级', () => {
    expect(compareAspectCompatible({ width: 1200, height: 800 }, { width: 1024, height: 1024 })).toBe(false)
    expect(compareAspectCompatible({ width: 1000, height: 1000 }, { width: 1030, height: 1000 })).toBe(false)
    expect(compareAspectCompatible({ width: 1000, height: 1000 }, { width: 1010, height: 1000 })).toBe(true)
  })

  it('尺寸缺失或无效时不做拦截', () => {
    expect(compareAspectCompatible(undefined, { width: 1024, height: 1024 })).toBe(true)
    expect(compareAspectCompatible({ width: 1200, height: 800 }, undefined)).toBe(true)
    expect(compareAspectCompatible({ width: 0, height: 0 }, { width: 1024, height: 1024 })).toBe(true)
  })
})
