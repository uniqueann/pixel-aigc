// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directionFromPoint } from './relightDirection'
import RelightDirectionOverlay from './RelightDirectionOverlay'

class ResizeObserverMock {
  private readonly callback: ResizeObserverCallback

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
  }

  observe() {
    this.callback(
      [{ contentRect: { width: 320, height: 320 } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    )
  }

  unobserve() {}

  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

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

describe('RelightDirectionOverlay', () => {
  it('平面光渲染实线主光箭头和虚线投影', () => {
    const { container } = render(<RelightDirectionOverlay direction="bottom" />)
    const main = container.querySelector('[data-role="main-light"]')
    expect(main).toBeTruthy()
    expect(main?.getAttribute('stroke-dasharray')).toBeNull()
    expect(container.querySelector('[data-role="shadow"]')?.getAttribute('stroke-dasharray')).toBe('4 6')
  })

  it('正面光不渲染主光箭头，渲染镜头徽标', () => {
    const { container } = render(<RelightDirectionOverlay direction="front" />)
    expect(container.querySelector('[data-role="main-light"]')).toBeNull()
    expect(container.querySelector('.relight-light-dot.is-front')).toBeTruthy()
    expect(container.querySelector('.relight-overlay-tag')?.textContent).toBe('正面光')
  })

  it('逆光不渲染主光箭头，渲染背后辉光与轮廓光', () => {
    const { container } = render(<RelightDirectionOverlay direction="back" />)
    expect(container.querySelector('[data-role="main-light"]')).toBeNull()
    expect(container.querySelector('[data-role="rim-light"]')).toBeTruthy()
    expect(container.querySelector('.relight-light-dot.is-back')).toBeTruthy()
    expect(container.querySelector('.relight-overlay-tag')?.textContent).toBe('逆光')
  })
})
