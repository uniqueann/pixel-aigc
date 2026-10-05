// @vitest-environment jsdom

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { App } from 'antd'
import { act, cleanup, render, screen } from '@testing-library/react'
import { usePreferencesStore } from '@/features/preferences/store'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsDialog from './SettingsDialog'

const SETTINGS_CSS = readFileSync(resolve(process.cwd(), 'src/styles/global.css'), 'utf8')

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
    expect(menu.textContent).toContain('通用')
    expect(menu.textContent).toContain('个性化')
    expect(menu.textContent).toContain('模型与密钥')
    expect(menu.textContent).toContain('数据控制')
    expect(menu.textContent).toContain('账号')

    expect((layout as HTMLElement).style.maxWidth).toBe('100%')
    expect((shell as HTMLElement).style.maxWidth).toBe('100%')
    expect((shell as HTMLElement).style.overflowX).toBe('auto')
    expect((shell as HTMLElement).style.scrollbarWidth).toBe('none')
    expect((modal as HTMLElement).style.maxWidth).toBe('calc(100vw - 24px)')
    expect(wrap.getAttribute('style') ?? '').toMatch(/overflow-x:\s*hidden/i)
    expect(menu.scrollWidth).toBeLessThanOrEqual(Math.max(menu.clientWidth, width))
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(Math.max(document.documentElement.clientWidth, width))
    expect(document.querySelector('.personalization-panel .setting-row')).toBeTruthy()
    expect(document.querySelector('.preferences-counts')).toBeTruthy()
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
  })

  it('样式表约束弹窗宽度并隐藏窄屏标签滚动条', () => {
    expect(SETTINGS_CSS).toContain('max-width: calc(100vw - 24px)')
    expect(SETTINGS_CSS).toContain('scrollbar-width: none')
    expect(SETTINGS_CSS).toContain('flex-wrap: wrap')
    expect(SETTINGS_CSS).toContain('.settings-modal-wrap')
    expect(SETTINGS_CSS).toMatch(/overflow-x:\s*hidden/)
    expect(SETTINGS_CSS).toContain('.settings-modal .preferences-global-error')
    expect(SETTINGS_CSS).toContain('position: sticky')
  })

  it('窄屏标签栏随内容收缩，设置项和开关保持横向排列', () => {
    const narrowLayout = SETTINGS_CSS.match(/\.settings-layout\.is-narrow\s*\{[^}]*\}/)?.[0] ?? ''
    expect(narrowLayout).toMatch(/min-height:\s*0/)
    expect(narrowLayout).toMatch(/align-content:\s*start/)
    const rowRules = SETTINGS_CSS.match(/\.settings-layout\.is-narrow \.setting-row\s*\{[^}]*\}/g) ?? []
    expect(rowRules.some(rule => /flex-direction:\s*row/.test(rule))).toBe(true)
    expect(rowRules.some(rule => /flex-direction:\s*column/.test(rule))).toBe(false)
    expect(SETTINGS_CSS).toMatch(/\.setting-row > \.ant-switch[\s\S]{0,180}width:\s*auto/)
    expect(SETTINGS_CSS).toContain('padding: var(--page-tab-gap) 22px 22px')
    const mobileBody = SETTINGS_CSS.slice(SETTINGS_CSS.lastIndexOf('@media (max-width: 720px)'))
    expect(mobileBody).toMatch(/\.settings-layout[\s\S]*?min-height:\s*0/)
    expect(mobileBody).toMatch(/overflow-y:\s*auto/)
    expect(SETTINGS_CSS).toMatch(/\.settings-layout\.is-narrow\s*\{[^}]*overflow:\s*visible/)
  })

  it('桌面端左栏铺满高度，超长时只滚动右侧内容', () => {
    const shell = SETTINGS_CSS.match(/\.settings-layout:not\(\.is-narrow\) > \.settings-menu-shell\s*\{[^}]*\}/)?.[0] ?? ''
    const content = SETTINGS_CSS.match(/\.settings-layout:not\(\.is-narrow\) > \.settings-content\s*\{[^}]*\}/)?.[0] ?? ''
    expect(shell).toMatch(/background:\s*var\(--color-bg\)/)
    expect(shell).toMatch(/border-inline-end:\s*1px solid var\(--color-border\)/)
    expect(content).toMatch(/overflow-y:\s*auto/)
    expect(content).toMatch(/min-height:\s*0/)
  })
})

describe('设置弹窗当前标签可见', () => {
  afterEach(() => {
    usePreferencesStore.setState({ error: null, status: 'local' })
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

  it('打开设置弹窗时仍能看到全局同步失败提示和重试同步', () => {
    stubMatchMedia(true)
    usePreferencesStore.setState({
      status: 'error',
      error: '个性化设置尚未同步：网络异常，请检查网络后重试',
    })
    render(
      <App>
        <SettingsDialog open section="personalization" narrow onClose={() => undefined} onSectionChange={() => undefined} />
      </App>,
    )
    const banners = screen.getAllByText('个性化设置尚未同步：网络异常，请检查网络后重试')
    expect(banners.length).toBeGreaterThanOrEqual(1)
    expect(document.querySelector('.settings-modal .preferences-global-error')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: '重试同步' }).length).toBeGreaterThanOrEqual(1)
  })
})
