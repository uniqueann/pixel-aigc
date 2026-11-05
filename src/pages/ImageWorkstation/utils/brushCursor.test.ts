import { describe, expect, it } from 'vitest'
import { brushCursorPlacement } from './brushCursor'

const rect = { x: 20, y: 10, width: 600, height: 400 }

describe('指针笔刷光标定位', () => {
  it('图片内保留实际坐标与笔刷尺寸', () => {
    expect(brushCursorPlacement({ x: 320, y: 210 }, rect, 28)).toEqual({
      left: 320,
      top: 210,
      size: 28,
      outside: false,
    })
  })

  it('边界像素算图片内，越界算图片外', () => {
    expect(brushCursorPlacement({ x: 20, y: 10 }, rect, 28).outside).toBe(false)
    expect(brushCursorPlacement({ x: 620, y: 410 }, rect, 28).outside).toBe(false)
    expect(brushCursorPlacement({ x: 19, y: 210 }, rect, 28).outside).toBe(true)
    expect(brushCursorPlacement({ x: 621, y: 210 }, rect, 28).outside).toBe(true)
    expect(brushCursorPlacement({ x: 320, y: 411 }, rect, 28).outside).toBe(true)
  })

  it('非法笔刷尺寸回退为 1px', () => {
    expect(brushCursorPlacement({ x: 320, y: 210 }, rect, 0).size).toBe(1)
    expect(brushCursorPlacement({ x: 320, y: 210 }, rect, Number.NaN).size).toBe(1)
  })
})
