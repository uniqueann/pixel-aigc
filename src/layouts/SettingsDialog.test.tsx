// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { App } from 'antd'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog'
import '@/styles/global.css'

function stubMatchMedia(narrow: boolean) {
  vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
    matches: narrow && String(query).includes('720px'),
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
  })))
}

function renderDialog(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width })
  stubMatchMedia(true)
  return render(
    <App>
      <SettingsDialog open section="personalization" narrow onClose={() => undefined} onSectionChange={() => undefined} />
    </App>,
  )
}

function expectNoNativeScrollbar(element: HTMLElement) {
  const style = getComputedStyle(element)
  expect(style.overflowX).not.toBe('scroll')
  expect(style.scrollbarWidth === 'none' || style.overflowX === 'hidden').toBe(true)
}

describe('设置弹窗窄屏布局', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it.each([390, 320])('%ipx 下标签可换行且隐藏原生滚动条，弹窗不超出视口', (width) => {
    renderDialog(width)
    const layout = document.querySelector('.settings-layout')
    const shell = document.querySelector('.settings-menu-shell')
    const menu = document.querySelector('.settings-menu')
    const modal = document.querySelector('.settings-modal')
    const wrap = document.querySelector('.settings-modal-wrap')
    if (!layout || !shell || !menu || !modal || !wrap) throw new Error('未渲染设置弹窗')

    expect(layout.classList.contains('is-narrow')).toBe(true)
    expect(shell.classList.contains('is-narrow')).toBe(true)
    expect(menu.classList.contains('is-narrow')).toBe(true)
    expect(screen.getByText('通用')).toBeTruthy()
    expect(screen.getByText('个性化')).toBeTruthy()
    expect(screen.getByText('模型与密钥')).toBeTruthy()

    expect(getComputedStyle(layout).maxWidth).toBe('100%')
    expect(getComputedStyle(menu).flexWrap).toBe('wrap')
    expectNoNativeScrollbar(menu)
    expectNoNativeScrollbar(shell)
    expect(getComputedStyle(wrap).overflowX).toBe('hidden')
    expect(getComputedStyle(modal).maxWidth).toBe('calc(100vw - 24px)')

    const row = document.querySelector('.personalization-panel .setting-row')
    const counts = document.querySelector('.preferences-counts')
    if (!row || !counts) throw new Error('未渲染个性化表单')
    expect(getComputedStyle(row).flexDirection).toBe('column')
    expect(getComputedStyle(counts).gridTemplateColumns).toContain('minmax(0, 1fr)')
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('样式表约束弹窗宽度并隐藏窄屏标签滚动条', () => {
    const css = readFileSync(new URL('../styles/global.css', import.meta.url), 'utf8')
    expect(css).toContain('max-width: calc(100vw - 24px)')
    expect(css).toContain('scrollbar-width: none')
    expect(css).toContain('flex-wrap: wrap')
    expect(css).toContain('.settings-modal-wrap')
    expect(css).toMatch(/overflow-x:\s*hidden/)
  })
})

describe('设置弹窗当前标签可见', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('打开后把当前分类滚到可见位置', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    stubMatchMedia(true)
    render(
      <App>
        <SettingsDialog open section="personalization" narrow onClose={() => undefined} onSectionChange={() => undefined} />
      </App>,
    )
    await act(async () => undefined)
    expect(scrollIntoView).toHaveBeenCalled()
  })
})
