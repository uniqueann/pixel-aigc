// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RELIGHT_DEFAULT, type RelightOptions } from '@shared/relight'
import RelightCompass from './RelightCompass'

afterEach(cleanup)

function renderCompass(value: Partial<RelightOptions> = {}, onChange = vi.fn()) {
  render(<RelightCompass value={{ ...RELIGHT_DEFAULT, ...value }} onChange={onChange} />)
  return onChange
}

describe('RelightCompass', () => {
  it('显示 8 个方位、中心正面和方向摘要', () => {
    renderCompass({ direction: 'top-left' })
    expect(screen.getByRole('radiogroup', { name: '光线方向' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: /^左上光/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^顶部光/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: /^正面光/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('主光：左上 · 柔光 · 中性')).toBeTruthy()
    expect(screen.getByText('主光从左上方来，投影落向右下方。')).toBeTruthy()
  })

  it('可访问名称包含主光与投影方向', () => {
    renderCompass({ direction: 'top-left' })
    expect(screen.getByRole('radio', { name: '左上光：主光从左上方来，投影落向右下方。' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '商品前方：主光从镜头方向来，投影落在商品后方。' })).toBeTruthy()
  })

  it('点击方位或中心正面更新方向', () => {
    const onChange = renderCompass({ direction: 'front' })
    fireEvent.click(screen.getByRole('radio', { name: /^右侧光/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'right' })
    fireEvent.click(screen.getByRole('radio', { name: /^正面光/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'front' })
  })

  it('背面模式只选中逆光，点击平面方位回到正面模式', () => {
    const onChange = renderCompass({ direction: 'back' })
    expect(screen.getByRole('radio', { name: /^背面 · 逆光/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^左上光/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('主光：逆光 · 柔光 · 中性')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /^左上光/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'top-left' })
  })

  it('方向键在 3×3 网格内移动并选择', () => {
    const onChange = renderCompass({ direction: 'top-left' })
    const cell = screen.getByRole('radio', { name: /^左上光/ })
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'top' })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'left' })
  })

  it('生成中禁用所有控件，但保留选中态', () => {
    render(<RelightCompass value={{ ...RELIGHT_DEFAULT, direction: 'right' }} disabled onChange={() => undefined} />)
    expect(screen.getByRole('radio', { name: /^右侧光/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^右侧光/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('radio', { name: /^商品前方/ })).toHaveProperty('disabled', true)
  })
})
