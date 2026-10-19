// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import AspectRatioIcon from './AspectRatioIcon'
import { computeAspectRect, resolveAspectRatio } from './aspectRatioGeometry'

describe('AspectRatioIcon', () => {
  it('正确解析比例数值', () => {
    expect(resolveAspectRatio('1:1')).toBeCloseTo(1)
    expect(resolveAspectRatio('16:9')).toBeCloseTo(16 / 9)
    expect(resolveAspectRatio('9:16')).toBeCloseTo(9 / 16)
    expect(resolveAspectRatio('4:3')).toBeCloseTo(4 / 3)
    expect(resolveAspectRatio('3:4')).toBeCloseTo(3 / 4)
    expect(resolveAspectRatio(undefined, 1920, 1080)).toBeCloseTo(16 / 9)
    expect(resolveAspectRatio(undefined, 1080, 1440)).toBeCloseTo(3 / 4)
    expect(resolveAspectRatio('invalid')).toBe(1)
    expect(resolveAspectRatio(undefined, 0, 0)).toBe(1)
  })

  it('对称生成横屏与竖屏线框尺寸', () => {
    const wide169 = computeAspectRect(16 / 9)
    const tall916 = computeAspectRect(9 / 16)
    expect(wide169.w).toBe(tall916.h)
    expect(wide169.h).toBe(tall916.w)

    const wide43 = computeAspectRect(4 / 3)
    const tall34 = computeAspectRect(3 / 4)
    expect(wide43.w).toBe(tall34.h)
    expect(wide43.h).toBe(tall34.w)

    const square11 = computeAspectRect(1)
    expect(square11.w).toBe(square11.h)
  })

  it('渲染 SVG 元素并包含无障碍隐藏属性与矩形元素', () => {
    const { container } = render(<AspectRatioIcon ratio="16:9" />)
    const svg = container.querySelector('svg')
    expect(svg).toBeTruthy()
    expect(svg?.getAttribute('aria-hidden')).toBe('true')
    expect(svg?.getAttribute('width')).toBe('18')
    expect(svg?.getAttribute('height')).toBe('18')
    expect(svg?.classList.contains('aspect-ratio-icon')).toBe(true)

    const rect = svg?.querySelector('rect')
    expect(rect).toBeTruthy()
    expect(Number(rect?.getAttribute('width'))).toBeGreaterThan(Number(rect?.getAttribute('height')))
    expect(rect?.getAttribute('stroke')).toBe('currentColor')
  })

  it('竖屏比例绘制的矩形高度大于宽度', () => {
    const { container } = render(<AspectRatioIcon ratio="9:16" />)
    const rect = container.querySelector('rect')
    expect(Number(rect?.getAttribute('height'))).toBeGreaterThan(Number(rect?.getAttribute('width')))
  })

  it('支持自定义尺寸与样式类', () => {
    const { container } = render(<AspectRatioIcon ratio="1:1" size={24} className="custom-ratio" strokeWidth={2} />)
    const svg = container.querySelector('svg')
    expect(svg?.getAttribute('width')).toBe('24')
    expect(svg?.getAttribute('height')).toBe('24')
    expect(svg?.classList.contains('custom-ratio')).toBe(true)
    const rect = svg?.querySelector('rect')
    expect(rect?.getAttribute('stroke-width')).toBe('2')
  })
})
