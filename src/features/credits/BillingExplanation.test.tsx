// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import BillingExplanation from './BillingExplanation'

afterEach(() => cleanup())

function renderExplanation(remaining = 18) {
  return render(<BillingExplanation freeBgRemoveRemaining={remaining} freeBgRemoveMonth="2026-10" />)
}

describe('计费说明展开', () => {
  it('进入时默认收起，只显示摘要和展开控件', () => {
    renderExplanation()
    const button = screen.getByRole('button', { name: /查看计费明细/ })
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-controls')).toBeTruthy()
    expect(screen.getByText('按功能扣分，商品抠图本月还可免费 18 张')).toBeTruthy()
    expect(screen.queryByRole('heading', { name: '生成类' })).toBeNull()
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('点击标题行展开后再收起，重新进入仍默认收起', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    const view = renderExplanation(7)
    const button = screen.getByRole('button', { name: /查看计费明细/ })
    button.focus()
    expect(document.activeElement).toBe(button)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    const panel = document.getElementById(button.getAttribute('aria-controls') ?? '')
    expect(panel?.hidden).toBe(false)
    expect(panel?.getAttribute('role')).toBe('region')
    expect(screen.getByRole('heading', { name: '生成类' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '编辑类' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '抠图与工具' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '预扣与退还' })).toBeTruthy()
    expect(screen.getByText(/本月还可免费 7 张/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /收起计费明细/ }))
    expect(screen.getByRole('button', { name: /查看计费明细/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('heading', { name: '生成类' })).toBeNull()
    expect(setItem).not.toHaveBeenCalled()
    view.unmount()
    renderExplanation(7)
    expect(screen.getByRole('button', { name: /查看计费明细/ }).getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('heading', { name: '编辑类' })).toBeNull()
    setItem.mockRestore()
  })
})
