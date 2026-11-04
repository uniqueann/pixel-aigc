// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { directionFromPoint } from './relightDirection'

describe('directionFromPoint', () => {
  it('把指针角度吸附到 8 个平面方向', () => {
    expect(directionFromPoint(0, -100, 200)).toBe('top')
    expect(directionFromPoint(100, -100, 200)).toBe('top-right')
    expect(directionFromPoint(100, 0, 200)).toBe('right')
    expect(directionFromPoint(100, 100, 200)).toBe('bottom-right')
    expect(directionFromPoint(0, 100, 200)).toBe('bottom')
    expect(directionFromPoint(-100, 100, 200)).toBe('bottom-left')
    expect(directionFromPoint(-100, 0, 200)).toBe('left')
    expect(directionFromPoint(-100, -100, 200)).toBe('top-left')
  })

  it('靠近中心时回到正面', () => {
    expect(directionFromPoint(0, 0, 200)).toBe('front')
    expect(directionFromPoint(10, 10, 200)).toBe('front')
  })
})
