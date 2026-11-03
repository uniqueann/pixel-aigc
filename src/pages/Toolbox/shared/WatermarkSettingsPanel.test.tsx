// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { App } from 'antd'
import { DEFAULT_WATERMARK_SETTINGS } from '../watermark/types'
import WatermarkSettingsPanel from './WatermarkSettingsPanel'

afterEach(() => cleanup())

function renderPanel(overrides: Partial<Parameters<typeof WatermarkSettingsPanel>[0]> = {}) {
  const props = {
    settings: DEFAULT_WATERMARK_SETTINGS,
    disabled: false,
    onChange: vi.fn(),
    onLogo: vi.fn(),
    templates: <div>模板区</div>,
    ...overrides,
  }
  render(<App><WatermarkSettingsPanel {...props} /></App>)
  return props
}

describe('水印设置面板', () => {
  it('分组、滑杆、开关和位置按钮都有可访问名称与状态', () => {
    renderPanel()
    expect(screen.getByRole('radiogroup', { name: '水印类型' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '文字颜色' })).toBeTruthy()
    expect(screen.getByRole('radiogroup', { name: '排列方式' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '位置' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: '文字大小：短边的 4%' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: '透明度：70%' })).toBeTruthy()
    expect(screen.getByRole('slider', { name: '边距：短边的 3%' })).toBeTruthy()
    expect(screen.getByRole('switch', { name: '可读性描边' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '右下' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '左上' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByText('模板区')).toBeTruthy()
  })

  it('自定义颜色通过可聚焦按钮打开命名对话框', () => {
    renderPanel({ settings: { ...DEFAULT_WATERMARK_SETTINGS, colorMode: 'custom' } })
    const trigger = screen.getByRole('button', { name: /自定义颜色/ })
    expect(trigger.getAttribute('aria-haspopup')).toBe('dialog')
    fireEvent.click(trigger)
    expect(screen.getByRole('dialog', { name: '水印文字颜色' })).toBeTruthy()
  })
})
