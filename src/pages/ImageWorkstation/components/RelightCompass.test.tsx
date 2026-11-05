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

function checkedRadios() {
  return screen.getAllByRole('radio').filter(radio => radio.getAttribute('aria-checked') === 'true')
}

describe('RelightCompass', () => {
  it('显示 8 个方位、中心商品和方向摘要', () => {
    renderCompass({ direction: 'top-left' })
    expect(screen.getByRole('radiogroup', { name: '光线方向' })).toBeTruthy()
    expect(screen.getAllByRole('radio')).toHaveLength(10)
    expect(screen.getByRole('radio', { name: /^左上光/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^顶部光/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByRole('radio', { name: /^正面光/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('主光：左上 · 柔光 · 中性')).toBeTruthy()
    expect(screen.getByText('主光从左上方来，投影落向右下方。')).toBeTruthy()
  })

  it('中心是商品图形，不是可选方向', () => {
    renderCompass()
    const center = screen.getByText('商品').closest('.relight-compass-center')
    expect(center?.tagName).toBe('DIV')
    expect(center?.getAttribute('aria-hidden')).toBe('true')
    expect(screen.queryByRole('radio', { name: /^商品/ })).toBeNull()
  })

  it('可访问名称包含主光与投影方向', () => {
    renderCompass({ direction: 'top-left' })
    expect(screen.getByRole('radio', { name: '左上光：主光从左上方来，投影落向右下方。' })).toBeTruthy()
    expect(screen.getByRole('radio', { name: '正面光：主光从镜头方向来，投影落在商品后方。' })).toBeTruthy()
  })

  it('光线预设一次写入方向、光质和色温', () => {
    const onChange = renderCompass()
    fireEvent.click(screen.getByRole('button', { name: '日落暖光' }))
    expect(onChange).toHaveBeenLastCalledWith({
      ...RELIGHT_DEFAULT,
      direction: 'bottom-left',
      quality: 'soft',
      temperature: 'warm',
    })
  })

  it('当前组合命中预设时显示按下态', () => {
    renderCompass({ direction: 'back', quality: 'hard', temperature: 'cool' })
    expect(screen.getByRole('button', { name: '冷调轮廓光' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '棚拍柔光' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('点击方位或正面更新方向', () => {
    const onChange = renderCompass({ direction: 'front' })
    fireEvent.click(screen.getByRole('radio', { name: /^右侧光/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'right' })
    fireEvent.click(screen.getByRole('radio', { name: /^正面光/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'front' })
  })

  it('任意方向都只有一个选中 radio', () => {
    const { rerender } = render(
      <RelightCompass value={{ ...RELIGHT_DEFAULT, direction: 'front' }} onChange={() => undefined} />,
    )
    let checked = checkedRadios()
    expect(checked).toHaveLength(1)
    expect(checked[0].getAttribute('aria-label')).toMatch(/^正面光/)

    rerender(<RelightCompass value={{ ...RELIGHT_DEFAULT, direction: 'back' }} onChange={() => undefined} />)
    checked = checkedRadios()
    expect(checked).toHaveLength(1)
    expect(checked[0].getAttribute('aria-label')).toMatch(/^逆光/)

    rerender(<RelightCompass value={{ ...RELIGHT_DEFAULT, direction: 'left' }} onChange={() => undefined} />)
    checked = checkedRadios()
    expect(checked).toHaveLength(1)
    expect(checked[0].getAttribute('aria-label')).toMatch(/^左侧光/)
  })

  it('逆光时网格不选中，点击平面方位回到平面光', () => {
    const onChange = renderCompass({ direction: 'back' })
    expect(screen.getByRole('radio', { name: /^逆光/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^左上光/ }).getAttribute('aria-checked')).toBe('false')
    expect(screen.getByText('主光：逆光 · 柔光 · 中性')).toBeTruthy()
    // 逆光弱化网格后仍要告诉用户怎么回到平面光。
    expect(screen.getByText('主光从商品背后而来，轮廓发光，投影铺向镜头。 点任一平面方向可切回平面光。')).toBeTruthy()
    fireEvent.click(screen.getByRole('radio', { name: /^左上光/ }))
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'top-left' })
  })

  it('方向键在 3×3 网格内移动并选择，穿过中心时落到对侧', () => {
    const onChange = renderCompass({ direction: 'top-left' })
    const cell = screen.getByRole('radio', { name: /^左上光/ })
    fireEvent.keyDown(cell, { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'top' })
    fireEvent.keyDown(cell, { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'left' })
    fireEvent.keyDown(screen.getByRole('radio', { name: /^左侧光/ }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'right' })
  })

  it('方向键可从底行进入深度行，并在正面/逆光间切换', () => {
    const onChange = renderCompass({ direction: 'bottom' })
    fireEvent.keyDown(screen.getByRole('radio', { name: /^底部光/ }), { key: 'ArrowDown' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'front' })
    fireEvent.keyDown(screen.getByRole('radio', { name: /^正面光/ }), { key: 'ArrowRight' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'back' })
    fireEvent.keyDown(screen.getByRole('radio', { name: /^逆光/ }), { key: 'ArrowUp' })
    expect(onChange).toHaveBeenLastCalledWith({ ...RELIGHT_DEFAULT, direction: 'bottom' })
  })

  it('roving tabindex 只停在当前方向', () => {
    renderCompass({ direction: 'front' })
    expect(screen.getByRole('radio', { name: /^正面光/ }).getAttribute('tabindex')).toBe('0')
    expect(screen.getByRole('radio', { name: /^左上光/ }).getAttribute('tabindex')).toBe('-1')
    expect(screen.getByRole('radio', { name: /^逆光/ }).getAttribute('tabindex')).toBe('-1')
  })

  it('生成中禁用所有控件，但保留选中态', () => {
    render(<RelightCompass value={{ ...RELIGHT_DEFAULT, direction: 'right' }} disabled onChange={() => undefined} />)
    expect(screen.getByRole('radio', { name: /^右侧光/ }).getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('radio', { name: /^右侧光/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('radio', { name: /^正面光/ })).toHaveProperty('disabled', true)
    expect(screen.getByRole('radio', { name: /^逆光/ })).toHaveProperty('disabled', true)
  })
})
