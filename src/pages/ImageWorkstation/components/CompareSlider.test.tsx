// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import CompareSlider from './CompareSlider'

afterEach(cleanup)

const sizes = {
  beforeSize: { width: 1200, height: 800 },
  afterSize: { width: 2048, height: 1365 },
}

function renderSlider() {
  return render(<CompareSlider beforeSrc="blob:before" afterSrc="blob:after" {...sizes} />)
}

function slider() {
  return screen.getByRole('slider', { name: '对比原图与结果' })
}

function frame() {
  return document.querySelector('.workstation-compare') as HTMLElement
}

function stubFrameRect(width = 400) {
  vi.spyOn(frame(), 'getBoundingClientRect').mockReturnValue({
    left: 0, top: 0, width, height: 300, right: width, bottom: 300, x: 0, y: 0, toJSON: () => ({}),
  } as DOMRect)
}

/** jsdom 没有 PointerEvent，用 MouseEvent 携带坐标派发同名指针事件。 */
function pointer(type: 'pointerdown' | 'pointermove' | 'pointerup', clientX: number, clientY: number) {
  fireEvent(frame(), new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 }))
}

function drag(clientX: number, clientY = 100) {
  pointer('pointerdown', 100, 100)
  pointer('pointermove', clientX, clientY)
  pointer('pointerup', clientX, clientY)
}

describe('精修画布前后对比', () => {
  it('默认五五分割，原图与结果同时存在', () => {
    renderSlider()
    expect(slider().getAttribute('aria-valuenow')).toBe('50')
    expect(slider().getAttribute('aria-valuetext')).toBe('原图 50%，精修后 50%')
    expect(screen.getByText('原图')).toBeTruthy()
    expect(screen.getByText('精修后')).toBeTruthy()
    expect(screen.getByAltText('当前编辑效果').getAttribute('src')).toBe('blob:after')
    expect((document.querySelector('.workstation-compare-layer.is-before') as HTMLElement).style.clipPath)
      .toBe('inset(0 50% 0 0)')
  })

  it('键盘方向键、Shift 微调与 Home/End 都能移动分割线', () => {
    renderSlider()
    fireEvent.keyDown(slider(), { key: 'ArrowRight' })
    expect(slider().getAttribute('aria-valuenow')).toBe('55')
    fireEvent.keyDown(slider(), { key: 'ArrowLeft', shiftKey: true })
    expect(slider().getAttribute('aria-valuenow')).toBe('54')
    fireEvent.keyDown(slider(), { key: 'PageDown' })
    expect(slider().getAttribute('aria-valuenow')).toBe('64')
    fireEvent.keyDown(slider(), { key: 'Home' })
    expect(slider().getAttribute('aria-valuenow')).toBe('0')
    fireEvent.keyDown(slider(), { key: 'End' })
    expect(slider().getAttribute('aria-valuenow')).toBe('100')
    expect((document.querySelector('.workstation-compare-layer.is-before') as HTMLElement).style.clipPath)
      .toBe('inset(0 0% 0 0)')
  })

  it('拖动分割线按对比框宽度换算位置', () => {
    renderSlider()
    stubFrameRect()
    drag(200)
    expect(slider().getAttribute('aria-valuenow')).toBe('50')
    drag(300)
    expect(slider().getAttribute('aria-valuenow')).toBe('75')
    drag(-40)
    expect(slider().getAttribute('aria-valuenow')).toBe('0')
  })

  it('点击画布跳转分割线，纵向滑动不误触', () => {
    renderSlider()
    stubFrameRect()
    pointer('pointerdown', 300, 100)
    pointer('pointerup', 300, 100)
    expect(slider().getAttribute('aria-valuenow')).toBe('75')

    pointer('pointerdown', 100, 100)
    pointer('pointermove', 102, 160)
    pointer('pointerup', 102, 160)
    expect(slider().getAttribute('aria-valuenow')).toBe('75')
  })

  it('双击复位到中间', () => {
    renderSlider()
    fireEvent.keyDown(slider(), { key: 'End' })
    expect(slider().getAttribute('aria-valuenow')).toBe('100')
    fireEvent.doubleClick(frame())
    expect(slider().getAttribute('aria-valuenow')).toBe('50')
  })

  it('1:1 按结果实际像素显示，再点回到适应画布', () => {
    renderSlider()
    const zoom = screen.getByRole('button', { name: '1:1' })
    fireEvent.click(zoom)
    expect(zoom.getAttribute('aria-pressed')).toBe('true')
    expect(frame().style.width).toBe('2048px')
    expect(frame().style.height).toBe('1365px')
    expect(document.querySelector('.workstation-compare-scroll')?.className).toContain('is-actual')

    fireEvent.click(zoom)
    expect(zoom.getAttribute('aria-pressed')).toBe('false')
    expect(frame().style.width).toBe('')
    expect(document.querySelector('.workstation-compare-scroll')?.className).not.toContain('is-actual')
  })

  it('对比框宽度为 0 时拖动不抛错也不改位置', () => {
    renderSlider()
    stubFrameRect(0)
    expect(() => drag(200)).not.toThrow()
    expect(slider().getAttribute('aria-valuenow')).toBe('50')
  })
})
