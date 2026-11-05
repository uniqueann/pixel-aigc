import { describe, expect, it } from 'vitest'
import { relightImageContentBox, relightOverlayGeometry } from './relightOverlayGeometry'

const SIZE = 320

describe('relightImageContentBox', () => {
  it('非方图按 contain 居中，叠加层只覆盖真实画面', () => {
    const box = relightImageContentBox(
      { left: 0, top: 0, width: 750, height: 395 },
      { left: 55, top: 0, width: 640, height: 395 },
      480,
      160,
    )
    expect(box).not.toBeNull()
    expect(box!.left).toBeCloseTo(55)
    expect(box!.top).toBeCloseTo(90.83, 1)
    expect(box!.width).toBeCloseTo(640)
    expect(box!.height).toBeCloseTo(213.33, 1)
  })

  it('图片尚未加载时返回 null，调用方回退到舞台尺寸', () => {
    expect(relightImageContentBox(
      { left: 0, top: 0, width: 750, height: 395 },
      { left: 0, top: 0, width: 750, height: 395 },
      0,
      0,
    )).toBeNull()
  })
})

describe('relightOverlayGeometry', () => {
  it('平面光用实线主光箭头，投影落在光源反方向', () => {
    const bottom = relightOverlayGeometry('bottom', SIZE, SIZE)
    expect(bottom.kind).toBe('planar')
    expect(bottom.lightStart).toBeDefined()
    expect(bottom.lightEnd).toBeDefined()
    expect(bottom.lightStart!.y).toBeGreaterThan(SIZE / 2)
    expect(bottom.shadowEnd.y).toBeLessThan(SIZE / 2)
    expect(bottom.handle).toEqual(bottom.lightStart)
  })

  it('正面光不画主光箭头，用镜头徽标，投影落在商品后方', () => {
    const front = relightOverlayGeometry('front', SIZE, SIZE)
    expect(front.kind).toBe('front')
    expect(front.lightStart).toBeUndefined()
    expect(front.camera).toBeDefined()
    expect(front.camera!.y).toBeGreaterThan(SIZE / 2)
    expect(front.shadowEnd.y).toBeLessThan(SIZE / 2)
    expect(front.shadowAngle).toBe(-90)
    expect(front.handle).toEqual(front.camera)
  })

  it('逆光不画主光箭头，用背后辉光与轮廓光，投影朝镜头', () => {
    const back = relightOverlayGeometry('back', SIZE, SIZE)
    expect(back.kind).toBe('back')
    expect(back.lightStart).toBeUndefined()
    expect(back.glow).toBeDefined()
    expect(back.glow!.y).toBeLessThan(SIZE / 2)
    expect(back.shadowEnd.y).toBeGreaterThan(SIZE / 2)
    expect(back.shadowAngle).toBe(90)
    expect(back.rimRadius).toBeGreaterThan(0)
    expect(back.handle).toEqual(back.glow)
  })

  it('正面与底部的几何语义不同，不再共用同一条主光箭头', () => {
    const front = relightOverlayGeometry('front', SIZE, SIZE)
    const bottom = relightOverlayGeometry('bottom', SIZE, SIZE)
    expect(front.kind).not.toBe(bottom.kind)
    expect(front.lightStart).toBeUndefined()
    expect(bottom.lightStart).toBeDefined()
  })

  it('八个平面方向都保留主光箭头，不使用正面/逆光徽标', () => {
    const planar = ['top', 'top-right', 'right', 'bottom-right', 'bottom', 'bottom-left', 'left', 'top-left'] as const
    for (const direction of planar) {
      const geometry = relightOverlayGeometry(direction, SIZE, SIZE)
      expect(geometry.kind, direction).toBe('planar')
      expect(geometry.lightStart, direction).toBeDefined()
      expect(geometry.lightEnd, direction).toBeDefined()
      expect(geometry.camera, direction).toBeUndefined()
      expect(geometry.glow, direction).toBeUndefined()
    }
  })
})
