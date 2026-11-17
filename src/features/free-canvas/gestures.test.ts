import { describe, expect, it } from 'vitest'
import { distance, midpoint, pinchViewport } from './gestures'

const viewport = { zoom: 0.5, panX: 100, panY: 40 }

describe('双指捏合视口', () => {
  it('几何helper', () => {
    expect(midpoint({ x: 0, y: 0 }, { x: 100, y: 50 })).toEqual({ x: 50, y: 25 })
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
  })

  it('距离与中心都不变时视口不变', () => {
    const next = pinchViewport({
      viewport, startDistance: 100, distance: 100,
      startMid: { x: 200, y: 150 }, mid: { x: 200, y: 150 },
    })
    expect(next).toEqual({ zoom: 0.5, panX: 100, panY: 40 })
  })

  it('两指张开一倍 → 缩放翻倍，且原中心下的内容仍在中心', () => {
    const startMid = { x: 200, y: 150 }
    const sceneX = (startMid.x - viewport.panX) / viewport.zoom
    const sceneY = (startMid.y - viewport.panY) / viewport.zoom
    const next = pinchViewport({ viewport, startDistance: 100, distance: 200, startMid, mid: startMid })
    expect(next.zoom).toBe(1)
    // 原来落在中心的那一点仍然在中心
    expect((startMid.x - next.panX) / next.zoom).toBeCloseTo(sceneX, 5)
    expect((startMid.y - next.panY) / next.zoom).toBeCloseTo(sceneY, 5)
  })

  it('双指整体平移时视口跟着平移', () => {
    const next = pinchViewport({
      viewport, startDistance: 100, distance: 100,
      startMid: { x: 200, y: 150 }, mid: { x: 230, y: 160 },
    })
    expect(next).toEqual({ zoom: 0.5, panX: 130, panY: 50 })
  })

  it('缩放被限制在 0.1–4', () => {
    expect(pinchViewport({ viewport, startDistance: 100, distance: 10_000, startMid: { x: 0, y: 0 }, mid: { x: 0, y: 0 } }).zoom).toBe(4)
    expect(pinchViewport({ viewport, startDistance: 100, distance: 1, startMid: { x: 0, y: 0 }, mid: { x: 0, y: 0 } }).zoom).toBe(0.1)
  })

  it('起始距离为 0 时不缩放（避免除零）', () => {
    const next = pinchViewport({
      viewport, startDistance: 0, distance: 120,
      startMid: { x: 200, y: 150 }, mid: { x: 200, y: 150 },
    })
    expect(next.zoom).toBe(0.5)
  })
})
