// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import BackgroundColorDialog from './BackgroundColorDialog'

afterEach(() => cleanup())

function renderDialog(overrides: Partial<Parameters<typeof BackgroundColorDialog>[0]> = {}) {
  const props = {
    open: true,
    value: '#FFFFFF',
    onClose: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  }
  render(<App><BackgroundColorDialog {...props} /></App>)
  return props
}

describe('背景颜色对话框', () => {
  it('有可访问名称、常用色预设和带标签的输入', () => {
    renderDialog()
    expect(screen.getByRole('dialog', { name: '背景颜色' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /白色/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /品牌绿/ })).toBeTruthy()
    expect(screen.getByLabelText('自定义颜色')).toBeTruthy()
    expect(screen.getByLabelText('十六进制颜色值')).toBeTruthy()
  })

  it('选择预设后应用并关闭', () => {
    const props = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: /品牌绿/ }))
    fireEvent.click(screen.getByRole('button', { name: '应用颜色' }))
    expect(props.onApply).toHaveBeenCalledWith('#21CFA0')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('输入合法 HEX 后应用规范化颜色', () => {
    const props = renderDialog()
    const input = screen.getByLabelText('十六进制颜色值')
    fireEvent.change(input, { target: { value: '#0a6b52' } })
    fireEvent.blur(input)
    fireEvent.click(screen.getByRole('button', { name: '应用颜色' }))
    expect(props.onApply).toHaveBeenCalledWith('#0A6B52')
  })

  it('非法 HEX 显示错误并阻止应用', () => {
    const props = renderDialog()
    const input = screen.getByLabelText('十六进制颜色值')
    fireEvent.change(input, { target: { value: '#12' } })
    fireEvent.blur(input)
    expect(screen.getByRole('alert').textContent).toContain('请输入')
    fireEvent.click(screen.getByRole('button', { name: '应用颜色' }))
    expect(props.onApply).not.toHaveBeenCalled()
  })
})
