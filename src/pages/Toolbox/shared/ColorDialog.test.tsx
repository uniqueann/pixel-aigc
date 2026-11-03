// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import ColorDialog from './ColorDialog'

afterEach(() => cleanup())

function renderDialog(overrides: Partial<Parameters<typeof ColorDialog>[0]> = {}) {
  const props = {
    open: true,
    value: '#FFFFFF',
    onClose: vi.fn(),
    onApply: vi.fn(),
    ...overrides,
  }
  render(<App><ColorDialog {...props} /></App>)
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

  it('支持自定义标题、预设标签与 id 前缀', () => {
    renderDialog({
      title: '水印文字颜色',
      presetsLabel: '常用文字颜色',
      presets: [{ label: '深灰', value: '#374151' }],
      idPrefix: 'watermark-color',
    })
    expect(screen.getByRole('dialog', { name: '水印文字颜色' })).toBeTruthy()
    expect(screen.getByText('常用文字颜色')).toBeTruthy()
    expect(screen.getByRole('button', { name: /深灰/ })).toBeTruthy()
    expect(screen.getByLabelText('自定义颜色').id).toBe('watermark-color-custom')
    expect(screen.getByLabelText('十六进制颜色值').id).toBe('watermark-color-hex')
  })
})
