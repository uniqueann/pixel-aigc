import { describe, expect, it } from 'vitest'
import { containStage, mapDisplayMask } from './mapDisplayMask'

describe('涂抹映射回原图', () => {
  it('画面外的笔迹不会进入原图', () => {
    const stageWidth = 8
    const stageHeight = 6
    const painted = new Uint8Array(stageWidth * stageHeight)
    painted.fill(255, 0, stageWidth)
    expect(containStage(stageWidth, stageHeight, 4, 2).offsetY).toBe(1)
    expect(mapDisplayMask(painted, stageWidth, stageHeight, 4, 2)).toBeNull()
  })

  it('画面里的白块落到原图对应像素', () => {
    const stageWidth = 4
    const stageHeight = 2
    const painted = new Uint8Array(stageWidth * stageHeight)
    painted[0] = 255
    const mask = mapDisplayMask(painted, stageWidth, stageHeight, 4, 2)
    expect(mask?.[0]).toBe(255)
    expect(mask?.[1]).toBe(0)
    expect(Array.from(mask ?? []).filter(value => value === 255)).toEqual([255])
  })

  it('覆盖整个画面时原图蒙版全白', () => {
    const stageWidth = 8
    const stageHeight = 6
    const painted = new Uint8Array(stageWidth * stageHeight)
    const frame = containStage(stageWidth, stageHeight, 4, 2)
    for (let y = Math.floor(frame.offsetY); y < Math.ceil(frame.offsetY + frame.height); y += 1) {
      for (let x = 0; x < stageWidth; x += 1) painted[y * stageWidth + x] = 200
    }
    const mask = mapDisplayMask(painted, stageWidth, stageHeight, 4, 2)
    expect(mask && Array.from(mask).every(value => value === 255)).toBe(true)
  })
})
